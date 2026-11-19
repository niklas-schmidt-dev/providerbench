//go:build linux || darwin

package platform

import (
	"context"
	"errors"
	"os"
	"runtime"
	"syscall"
	"time"
)

const kernelProbes = true

// syscallCost returns the nanoseconds one trivial system call takes.
// getppid does no work in the kernel, so this is the price of the boundary
// itself: mode switch, speculation mitigations and — in a sandbox that
// intercepts system calls — the trip through its userspace kernel.
func syscallCost(ctx context.Context, d time.Duration) float64 {
	const batch = 1000
	var calls int64
	start := time.Now()
	for time.Since(start) < d && ctx.Err() == nil {
		for range batch {
			syscall.Getppid()
		}
		calls += batch
	}
	return float64(time.Since(start).Nanoseconds()) / float64(calls)
}

// pipeRoundTrip returns the microseconds one ping-pong between two threads
// takes: each side blocks in read(2) until the other writes one byte, so a
// round trip is two thread wake-ups. In a virtual machine a wake-up of an
// idle vCPU is an inter-processor interrupt and an exit from halt, both of
// which the hypervisor mediates.
func pipeRoundTrip(ctx context.Context, d time.Duration) (float64, error) {
	// Both threads need a scheduler slot of their own; otherwise the wake-up
	// would wait for the Go runtime to hand one over.
	if procs := runtime.GOMAXPROCS(0); procs < 2 {
		runtime.GOMAXPROCS(2)
		defer runtime.GOMAXPROCS(procs)
	}

	var ping, pong [2]int
	if err := syscall.Pipe(ping[:]); err != nil {
		return 0, err
	}
	if err := syscall.Pipe(pong[:]); err != nil {
		syscall.Close(ping[0])
		syscall.Close(ping[1])
		return 0, err
	}
	fds := []int{ping[0], ping[1], pong[0], pong[1]}
	for _, fd := range fds {
		syscall.CloseOnExec(fd)
	}
	closed := make(map[int]bool, len(fds))
	closeFD := func(fd int) {
		if !closed[fd] {
			closed[fd] = true
			syscall.Close(fd)
		}
	}
	defer func() {
		for _, fd := range fds {
			closeFD(fd)
		}
	}()

	echoDone := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		buf := make([]byte, 1)
		for {
			n, err := readByte(ping[0], buf)
			if err != nil {
				echoDone <- err
				return
			}
			if n == 0 { // writer closed: the measurement is over
				echoDone <- nil
				return
			}
			if err := writeByte(pong[1], buf); err != nil {
				echoDone <- err
				return
			}
		}
	}()

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	buf := []byte{1}
	roundTrip := func() error {
		if err := writeByte(ping[1], buf); err != nil {
			return err
		}
		n, err := readByte(pong[0], buf)
		if err == nil && n == 0 {
			err = errors.New("echo thread closed the pipe")
		}
		return err
	}
	finish := func(err error) (float64, error) {
		closeFD(ping[1]) // unblocks the echo thread
		if echoErr := <-echoDone; err == nil {
			err = echoErr
		}
		return 0, err
	}

	for range 200 { // warm both threads and the pipe buffers
		if err := roundTrip(); err != nil {
			return finish(err)
		}
	}
	const batch = 100
	var trips int64
	start := time.Now()
	for time.Since(start) < d && ctx.Err() == nil {
		for range batch {
			if err := roundTrip(); err != nil {
				return finish(err)
			}
		}
		trips += batch
	}
	elapsed := time.Since(start)
	if _, err := finish(nil); err != nil {
		return 0, err
	}
	return float64(elapsed.Nanoseconds()) / float64(trips) / 1000, nil
}

func readByte(fd int, buf []byte) (int, error) {
	for {
		n, err := syscall.Read(fd, buf)
		if err == syscall.EINTR {
			continue
		}
		return n, err
	}
}

func writeByte(fd int, buf []byte) error {
	for {
		_, err := syscall.Write(fd, buf)
		if err == syscall.EINTR {
			continue
		}
		return err
	}
}

// firstTouch maps fresh anonymous memory and writes one byte to every page,
// returning the gigabytes per second the kernel can hand out. Each first
// write is a page fault: the kernel finds and zeroes a page, and a hypervisor
// adds a second level of address translation to fill. Only the touching is
// timed, not the mapping calls around it.
func firstTouch(ctx context.Context, d time.Duration, size int) (float64, int, error) {
	pageSize := os.Getpagesize()
	var touched time.Duration
	var bytes int64
	start := time.Now()
	for rounds := 0; (time.Since(start) < d || rounds < 3) && ctx.Err() == nil; rounds++ {
		mem, err := syscall.Mmap(-1, 0, size, syscall.PROT_READ|syscall.PROT_WRITE, syscall.MAP_ANON|syscall.MAP_PRIVATE)
		if err != nil {
			return 0, pageSize, err
		}
		declineHugePages(mem)
		began := time.Now()
		for off := 0; off < size; off += pageSize {
			mem[off] = 1
		}
		touched += time.Since(began)
		bytes += int64(size)
		if err := syscall.Munmap(mem); err != nil {
			return 0, pageSize, err
		}
	}
	if touched <= 0 {
		return 0, pageSize, errors.New("no memory was touched")
	}
	return float64(bytes) / touched.Seconds() / 1e9, pageSize, nil
}
