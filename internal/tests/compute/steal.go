package compute

import (
	"context"
	"crypto/sha256"
	"runtime"
	"sync"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(stealTest{}) }

// stealTest looks for signs of overselling: CPU time stolen by the
// hypervisor and run-to-run variance of a fixed workload. On honest
// hardware, identical work takes identical time.
type stealTest struct{}

func (stealTest) Name() string { return "steal" }
func (stealTest) Description() string {
	return "Overselling indicators: CPU steal time and performance consistency"
}

func (stealTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("steal")

	// Calibrate a work unit to ~20ms of single-core hashing on this machine.
	opts.Logf("steal: calibrating work unit...")
	buf := make([]byte, cpuChunk)
	t := time.Now()
	for range 32 {
		sha256.Sum256(buf)
	}
	perIter := time.Since(t) / 32
	iters := int(20 * time.Millisecond / max(perIter, time.Microsecond))

	// Run identical units back to back and look at the spread.
	units := 400
	if opts.Quick {
		units = 120
	}
	opts.Logf("steal: consistency, %d fixed work units...", units)
	times := make([]float64, 0, units)
	for range units {
		if ctx.Err() != nil {
			break
		}
		t := time.Now()
		for range iters {
			sha256.Sum256(buf)
		}
		times = append(times, float64(time.Since(t).Microseconds())/1000)
	}

	// Saturate all cores and read CPU steal from the kernel (Linux only).
	spinDur := opts.Pick(5*time.Second, 2*time.Second)
	opts.Logf("steal: sampling CPU steal while spinning %d cores (%s)...", runtime.NumCPU(), spinDur)
	before, beforeOK := readCPUSteal()
	var wg sync.WaitGroup
	spinCtx, cancel := context.WithTimeout(ctx, spinDur)
	for range runtime.NumCPU() {
		wg.Go(func() {
			for spinCtx.Err() == nil {
				sha256.Sum256(buf)
			}
		})
	}
	wg.Wait()
	cancel()
	after, afterOK := readCPUSteal()

	med := median(times)
	res.Add("unit_time_p50", med, "ms", false)
	res.Add("consistency_cv", coefficientOfVariation(times), "%", false)
	if med > 0 {
		res.Add("p99_over_p50", percentile(times, 99)/med, "ratio", false)
	}
	if beforeOK && afterOK {
		totalDelta := after.total - before.total
		stealPct := 0.0
		if totalDelta > 0 {
			stealPct = float64(after.steal-before.steal) / float64(totalDelta) * 100
		}
		res.Add("cpu_steal", stealPct, "%", false)
	} else {
		res.Note("cpu_steal requires /proc/stat and is only available on Linux")
	}
	res.Note("consistency_cv near 0%% and p99_over_p50 near 1.0 indicate a quiet host; high values suggest noisy neighbors or throttling")
	finish(res)
	return res, ctx.Err()
}
