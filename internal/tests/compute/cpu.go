package compute

import (
	"context"
	"crypto/sha256"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(cpuTest{}) }

type cpuTest struct{}

func (cpuTest) Name() string { return "cpu" }
func (cpuTest) Description() string {
	return "SHA-256 throughput, single-core and all-cores, plus scaling efficiency"
}

const cpuChunk = 64 * 1024

// hashFor hashes a fixed buffer in a loop until the deadline and returns the
// number of bytes processed.
func hashFor(ctx context.Context, d time.Duration) int64 {
	buf := make([]byte, cpuChunk)
	for i := range buf {
		buf[i] = byte(i)
	}
	var processed int64
	deadline := time.Now().Add(d)
	var sink [32]byte
	for time.Now().Before(deadline) && ctx.Err() == nil {
		// A few iterations per clock check keeps timer overhead negligible.
		for range 8 {
			sink = sha256.Sum256(buf)
			processed += cpuChunk
		}
	}
	runtime.KeepAlive(sink)
	return processed
}

func (cpuTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("cpu")
	dur := opts.Pick(3*time.Second, 1*time.Second)
	cores := runtime.NumCPU()

	opts.Logf("cpu: single-core hashing (%s)...", dur)
	start := time.Now()
	singleBytes := hashFor(ctx, dur)
	singleMBps := float64(singleBytes) / time.Since(start).Seconds() / 1e6

	opts.Logf("cpu: all-cores hashing on %d cores (%s)...", cores, dur)
	var totalBytes atomic.Int64
	start = time.Now()
	done := make(chan struct{})
	for range cores {
		go func() {
			totalBytes.Add(hashFor(ctx, dur))
			done <- struct{}{}
		}()
	}
	for range cores {
		<-done
	}
	multiMBps := float64(totalBytes.Load()) / time.Since(start).Seconds() / 1e6

	scaling := 0.0
	if singleMBps > 0 && cores > 0 {
		scaling = multiMBps / (singleMBps * float64(cores)) * 100
	}

	res.Add("single_core_hash", singleMBps, "MB/s", true)
	res.Add("multi_core_hash", multiMBps, "MB/s", true)
	res.Add("scaling_efficiency", scaling, "%", true)
	res.Note("SHA-256 over 64 KiB buffers; uses CPU crypto extensions where available")
	finish(res)
	return res, ctx.Err()
}
