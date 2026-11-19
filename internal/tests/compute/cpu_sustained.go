package compute

import (
	"context"
	"crypto/sha256"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(cpuSustainedTest{}) }

// cpuSustainedTest keeps every logical CPU hashing for ten minutes and
// watches the throughput in ten-second windows. It runs the same SHA-256
// kernel as the cpu test, so its first windows line up with multi_core_hash.
type cpuSustainedTest struct{}

func (cpuSustainedTest) Name() string    { return "cpu_sustained" }
func (cpuSustainedTest) Profile() string { return bench.SustainedProfile }
func (cpuSustainedTest) Description() string {
	return "All-core SHA-256 for 10 minutes in 10 s windows: what is left after the burst"
}

const cpuSustainedDuration = 10 * time.Minute

func (cpuSustainedTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	total, err := sustainedDuration(opts, cpuSustainedDuration)
	if err != nil {
		return nil, fmt.Errorf("cpu_sustained: %w", err)
	}
	return runCPUSustained(ctx, opts, total, sustainedWindow)
}

func runCPUSustained(ctx context.Context, opts Options, total, window time.Duration) (*bench.Result, error) {
	res := newResult("cpu_sustained")
	cores := runtime.NumCPU()
	opts.Logf("cpu_sustained: hashing on %d cores for %s...", cores, total)

	var hashed atomic.Int64
	workCtx, stop := context.WithCancel(ctx)
	var wg sync.WaitGroup
	for range cores {
		wg.Go(func() {
			buf := make([]byte, cpuChunk)
			for i := range buf {
				buf[i] = byte(i)
			}
			var sink [32]byte
			for workCtx.Err() == nil {
				for range 8 {
					sink = sha256.Sum256(buf)
				}
				hashed.Add(8 * cpuChunk)
			}
			runtime.KeepAlive(sink)
		})
	}

	before, beforeOK := readCPUSteal()
	rates, err := sampleWindows(ctx, total, window, hashed.Load)
	after, afterOK := readCPUSteal()
	stop()
	wg.Wait()
	if err != nil {
		return nil, fmt.Errorf("cpu_sustained: %w", err)
	}
	for i := range rates {
		rates[i] /= 1e6 // bytes/s to MB/s
	}
	summary, err := summarizeWindows(rates, window)
	if err != nil {
		return nil, fmt.Errorf("cpu_sustained: %w", err)
	}

	addSustainedMetrics(res, "throughput", "MB/s", summary)
	if beforeOK && afterOK {
		stealPct := 0.0
		if delta := after.total - before.total; delta > 0 {
			stealPct = float64(after.steal-before.steal) / float64(delta) * 100
		}
		res.Add("cpu_steal", stealPct, "%", false)
	} else {
		res.Note("cpu_steal requires /proc/stat and is only available on Linux")
	}
	noteWindows(res, "MB/s", rates, window, summary)
	res.Note("initial is the first %d windows, sustained the last %d; retained is their ratio", sustainedInitial, sustainedFinal)
	finish(res)
	return res, ctx.Err()
}
