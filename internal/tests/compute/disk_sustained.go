package compute

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(diskSustainedTest{}) }

// diskSustainedTest writes random 4 KiB blocks for five minutes and watches
// the rate in ten-second windows. Network block storage is often sold with a
// burst bucket: the advertised IOPS hold until the bucket empties, then the
// volume drops to its baseline. Thin-provisioned and cache-fronted local
// disks show the same shape for different reasons.
type diskSustainedTest struct{}

func (diskSustainedTest) Name() string    { return "disk_sustained" }
func (diskSustainedTest) Profile() string { return bench.SustainedProfile }
func (diskSustainedTest) Description() string {
	return "Random 4K direct writes for 5 minutes in 10 s windows: IOPS once the burst is spent"
}

const (
	diskSustainedDuration = 5 * time.Minute
	diskSustainedFile     = 1 << 30
	diskSustainedWorkers  = 4
)

func (diskSustainedTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	total, err := sustainedDuration(opts, diskSustainedDuration)
	if err != nil {
		return nil, fmt.Errorf("disk_sustained: %w", err)
	}
	return runDiskSustained(ctx, opts, total, sustainedWindow, diskSustainedFile)
}

func runDiskSustained(ctx context.Context, opts Options, total, window time.Duration, fileSize int64) (*bench.Result, error) {
	res := newResult("disk_sustained")
	dir := opts.Dir
	if dir == "" {
		dir = "."
	}
	path := filepath.Join(dir, ".providerbench-disk-sustained.tmp")
	defer os.Remove(path)

	// Lay the file out first. Overwriting allocated blocks is the steady
	// state of a database; allocating them is a different, one-off cost.
	opts.Logf("disk_sustained: laying out a %d MiB file at %s ...", fileSize>>20, path)
	if err := layOutFile(ctx, path, fileSize); err != nil {
		return nil, fmt.Errorf("disk_sustained: lay out file: %w", err)
	}

	f, direct, err := openDirectWrite(path)
	if err != nil {
		return nil, fmt.Errorf("disk_sustained: open for writing: %w", err)
	}
	defer f.Close()

	opts.Logf("disk_sustained: random 4K writes at queue depth %d for %s...", diskSustainedWorkers, total)
	var writes atomic.Int64
	workCtx, stop := context.WithCancel(ctx)
	errs := make(chan error, diskSustainedWorkers)
	var wg sync.WaitGroup
	for worker := range diskSustainedWorkers {
		wg.Go(func() {
			if err := randomWrites(workCtx, f, fileSize/diskAlign, int64(worker), &writes); err != nil {
				errs <- err
				stop()
			}
		})
	}
	rates, sampleErr := sampleWindows(workCtx, total, window, writes.Load)
	stop()
	wg.Wait()
	select {
	case err := <-errs:
		return nil, fmt.Errorf("disk_sustained: write: %w", err)
	default:
	}
	if sampleErr != nil {
		return nil, fmt.Errorf("disk_sustained: %w", sampleErr)
	}
	if err := f.Sync(); err != nil {
		return nil, fmt.Errorf("disk_sustained: fsync: %w", err)
	}
	summary, err := summarizeWindows(rates, window)
	if err != nil {
		return nil, fmt.Errorf("disk_sustained: %w", err)
	}

	addSustainedMetrics(res, "write_iops", "IOPS", summary)
	noteWindows(res, "IOPS", rates, window, summary)
	if direct {
		res.Note("writes bypass the page cache (direct I/O); each block is unique")
	} else {
		res.Note("page cache could not be bypassed on this platform; write numbers may reflect memory, not the device")
	}
	res.Note("test file: %d MiB, laid out before timing; random 4 KiB overwrites at queue depth %d", fileSize>>20, diskSustainedWorkers)
	finish(res)
	return res, ctx.Err()
}

// layOutFile writes size bytes of unique blocks and syncs them.
func layOutFile(ctx context.Context, path string, size int64) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	disableWriteCache(f)
	block := alignedBuf(diskBlock, diskAlign)
	rand.New(rand.NewSource(42)).Read(block)
	for written := int64(0); written < size; {
		if err := ctx.Err(); err != nil {
			return err
		}
		for off := 0; off < diskBlock; off += 512 << 10 {
			binary.LittleEndian.PutUint64(block[off:], uint64(written)+uint64(off))
		}
		n, err := f.Write(block)
		if err != nil {
			return err
		}
		if n != len(block) {
			return io.ErrShortWrite
		}
		written += int64(n)
	}
	return f.Sync()
}

// randomWrites overwrites random aligned 4 KiB blocks until the context
// ends. Every block carries a fresh counter so the device never sees the
// same content twice.
func randomWrites(ctx context.Context, file io.WriterAt, blocks, seed int64, writes *atomic.Int64) error {
	buf := alignedBuf(diskAlign, diskAlign)
	rng := rand.New(rand.NewSource(seed))
	rng.Read(buf)
	for sequence := uint64(0); ctx.Err() == nil; sequence++ {
		binary.LittleEndian.PutUint64(buf, sequence)
		binary.LittleEndian.PutUint64(buf[8:], uint64(seed))
		n, err := file.WriteAt(buf, rng.Int63n(blocks)*diskAlign)
		if err != nil {
			return err
		}
		if n != len(buf) {
			return io.ErrShortWrite
		}
		writes.Add(1)
	}
	return nil
}
