package compute

import (
	"context"
	"encoding/binary"
	"errors"
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
		if n != len(block) {
			f.Close()
			return nil, fmt.Errorf("disk: write: %w", io.ErrShortWrite)
		}
		written += int64(n)
	}
	if err := ctx.Err(); err != nil {
		f.Close()
		return nil, fmt.Errorf("disk: sequential write: %w", err)
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
	syncMs, err := measureFsyncLatency(ctx, f, page, iters)
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("disk: fsync latency: %w", err)
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
	if err := ctx.Err(); err != nil {
		rf.Close()
		return nil, fmt.Errorf("disk: sequential read: %w", err)
	}
	readMBps := float64(read) / time.Since(start).Seconds() / 1e6

	// --- Random 4K reads at queue depth 4 ---
	opts.Logf("disk: random 4K reads (QD4)...")
	blocks := fileSize / diskAlign
	dur := opts.Pick(2*time.Second, 1*time.Second)
	const workers = 4
	iops, err := measureRandomReadIOPS(ctx, rf, blocks, dur, workers)
	if err != nil {
		rf.Close()
		return nil, fmt.Errorf("disk: random 4K read: %w", err)
	}
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

type fsyncFile interface {
	WriteAt([]byte, int64) (int, error)
	Sync() error
}

func measureFsyncLatency(ctx context.Context, file fsyncFile, page []byte, iterations int) ([]float64, error) {
	if iterations < 1 {
		return nil, errors.New("no fsync iterations configured")
	}
	samples := make([]float64, 0, iterations)
	for range iterations {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		started := time.Now()
		n, err := file.WriteAt(page, 0)
		if err != nil {
			return nil, fmt.Errorf("write 4K page: %w", err)
		}
		if n != len(page) {
			return nil, fmt.Errorf("write 4K page: %w", io.ErrShortWrite)
		}
		if err := file.Sync(); err != nil {
			return nil, fmt.Errorf("sync 4K page: %w", err)
		}
		samples = append(samples, float64(time.Since(started).Microseconds())/1000)
	}
	if len(samples) == 0 {
		return nil, errors.New("fsync workload produced no samples")
	}
	return samples, nil
}

func measureRandomReadIOPS(
	ctx context.Context,
	reader io.ReaderAt,
	blocks int64,
	duration time.Duration,
	workers int,
) (float64, error) {
	if blocks < 1 || duration <= 0 || workers < 1 {
		return 0, errors.New("random-read workload has invalid configuration")
	}
	workerCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var ops atomic.Int64
	errs := make(chan error, 1)
	var wait sync.WaitGroup
	started := time.Now()
	deadline := started.Add(duration)
	for worker := range workers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			buf := alignedBuf(diskAlign, diskAlign)
			rng := rand.New(rand.NewSource(int64(worker)))
			for time.Now().Before(deadline) {
				if err := workerCtx.Err(); err != nil {
					return
				}
				offset := rng.Int63n(blocks) * diskAlign
				n, err := reader.ReadAt(buf, offset)
				if err == nil && n != len(buf) {
					err = io.ErrUnexpectedEOF
				}
				if err != nil {
					select {
					case errs <- err:
						cancel()
					default:
					}
					return
				}
				ops.Add(1)
			}
		}()
	}
	wait.Wait()

	select {
	case err := <-errs:
		return 0, err
	default:
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	elapsed := time.Since(started).Seconds()
	if ops.Load() == 0 || elapsed <= 0 {
		return 0, errors.New("random-read workload produced no samples")
	}
	return float64(ops.Load()) / elapsed, nil
}
