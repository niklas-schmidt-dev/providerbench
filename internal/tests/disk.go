package tests

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(diskTest{}) }

type diskTest struct{}

func (diskTest) Name() string { return "disk" }
func (diskTest) Description() string {
	return "Sequential read/write throughput, random 4K read IOPS and fsync latency"
}

const (
	diskBlock = 4 << 20 // 4 MiB sequential block
	diskAlign = 4096
)

func (diskTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("disk")
	dir := opts.Dir
	if dir == "" {
		dir = "."
	}
	fileSize := int64(1 << 30) // 1 GiB
	if opts.Quick {
		fileSize = 256 << 20
	}
	path := filepath.Join(dir, ".providerbench-disk.tmp")
	defer os.Remove(path)

	// --- Sequential write (includes final fsync) ---
	opts.Logf("disk: sequential write of %d MiB to %s ...", fileSize>>20, path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("disk: create test file: %w", err)
	}
	disableWriteCache(f)
	block := alignedBuf(diskBlock, diskAlign)
	rand.New(rand.NewSource(42)).Read(block)

	start := time.Now()
	var written int64
	for written < fileSize && ctx.Err() == nil {
		// Stamp a counter into each 512 KiB chunk so blocks stay unique —
		// otherwise dedup/compression on fancy storage inflates results.
		for off := 0; off < diskBlock; off += 512 << 10 {
			binary.LittleEndian.PutUint64(block[off:], uint64(written)+uint64(off))
		}
		n, err := f.Write(block)
		if err != nil {
			f.Close()
			return nil, fmt.Errorf("disk: write: %w", err)
		}
		written += int64(n)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return nil, fmt.Errorf("disk: fsync: %w", err)
	}
	writeMBps := float64(written) / time.Since(start).Seconds() / 1e6

	// --- fsync latency: small append + fsync, the database workload ---
	opts.Logf("disk: fsync latency...")
	iters := 50
	if opts.Quick {
		iters = 20
	}
	page := alignedBuf(diskAlign, diskAlign)
	var syncMs []float64
	for range iters {
		if ctx.Err() != nil {
			break
		}
		t := time.Now()
		if _, err := f.WriteAt(page, 0); err != nil {
			break
		}
		if err := f.Sync(); err != nil {
			break
		}
		syncMs = append(syncMs, float64(time.Since(t).Microseconds())/1000)
	}
	f.Close()

	// --- Sequential read, page cache bypassed where the platform allows ---
	opts.Logf("disk: sequential read...")
	rf, direct, err := openDirect(path)
	if err != nil {
		return nil, fmt.Errorf("disk: open for read: %w", err)
	}
	readBuf := alignedBuf(diskBlock, diskAlign)
	start = time.Now()
	var read int64
	for ctx.Err() == nil {
		n, err := rf.ReadAt(readBuf, read)
		read += int64(n)
		if err == io.EOF || read >= fileSize {
			break
		}
		if err != nil {
			rf.Close()
			return nil, fmt.Errorf("disk: read: %w", err)
		}
	}
	readMBps := float64(read) / time.Since(start).Seconds() / 1e6

	// --- Random 4K reads at queue depth 4 ---
	opts.Logf("disk: random 4K reads (QD4)...")
	blocks := fileSize / diskAlign
	dur := opts.Pick(2*time.Second, 1*time.Second)
	var ops atomic.Int64
	done := make(chan struct{})
	const workers = 4
	start = time.Now()
	for w := range workers {
		go func() {
			defer func() { done <- struct{}{} }()
			buf := alignedBuf(diskAlign, diskAlign)
			rng := rand.New(rand.NewSource(int64(w)))
			deadline := time.Now().Add(dur)
			for time.Now().Before(deadline) && ctx.Err() == nil {
				off := rng.Int63n(blocks) * diskAlign
				if _, err := rf.ReadAt(buf, off); err != nil {
					return
				}
				ops.Add(1)
			}
		}()
	}
	for range workers {
		<-done
	}
	iops := float64(ops.Load()) / time.Since(start).Seconds()
	rf.Close()

	res.Add("seq_write", writeMBps, "MB/s", true)
	res.Add("seq_read", readMBps, "MB/s", true)
	res.Add("rand_read_4k", iops, "IOPS", true)
	res.Add("fsync_latency_p50", median(syncMs), "ms", false)
	if direct {
		res.Note("reads bypass the page cache (direct I/O)")
	} else {
		res.Note("page cache could not be bypassed on this platform; read numbers may be inflated")
	}
	res.Note("test file: %d MiB, random reads at queue depth %d", fileSize>>20, workers)
	finish(res)
	return res, ctx.Err()
}
