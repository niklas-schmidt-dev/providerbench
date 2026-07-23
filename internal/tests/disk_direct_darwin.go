//go:build darwin

package tests

import (
	"os"
	"syscall"
	"unsafe"
)

const fNOCACHE = 48 // F_NOCACHE from sys/fcntl.h

// openDirect opens path for reading with F_NOCACHE so reads bypass the
// unified buffer cache.
func openDirect(path string) (*os.File, bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	_, _, errno := syscall.Syscall(syscall.SYS_FCNTL, f.Fd(), fNOCACHE, 1)
	return f, errno == 0, nil
}

// disableWriteCache marks a freshly written file uncachable so the read
// phase measures the device, not the unified buffer cache.
func disableWriteCache(f *os.File) {
	syscall.Syscall(syscall.SYS_FCNTL, f.Fd(), fNOCACHE, 1)
}

func alignedBuf(size, align int) []byte {
	raw := make([]byte, size+align)
	off := int(uintptr(unsafe.Pointer(&raw[0])) & uintptr(align-1))
	if off != 0 {
		off = align - off
	}
	return raw[off : off+size]
}
