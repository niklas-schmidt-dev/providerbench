// Package kit holds the small measurement helpers shared by the benchmark
// suites: sample statistics and a deadline-driven throughput loop.
package kit

import (
	"context"
	"math"
	"runtime"
	"sort"
	"sync"
	"time"
)

// Percentile interpolates linearly between the two nearest ranks, matching
// the compute suite and the site's aggregator.
func Percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := append([]float64(nil), xs...)
	sort.Float64s(sorted)
	idx := p / 100 * float64(len(sorted)-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

func Median(xs []float64) float64 { return Percentile(xs, 50) }

func Mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

// CV returns the sample standard deviation over the mean, as a percentage.
func CV(xs []float64) float64 {
	m := Mean(xs)
	if m == 0 || len(xs) < 2 {
		return 0
	}
	varSum := 0.0
	for _, x := range xs {
		varSum += (x - m) * (x - m)
	}
	return math.Sqrt(varSum/float64(len(xs)-1)) / m * 100
}

// Parallelism is the number of threads that can run at once: the machine's
// logical CPUs, capped by a container CPU quota where one applies. "All
// cores" in the workload and platform suites means this many workers.
//
// It is deliberately not runtime.NumCPU: a container sold as two CPUs
// through a quota still shows every core of its host, and starting one
// worker per visible core would measure the Go scheduler taking turns.
func Parallelism() int { return runtime.GOMAXPROCS(0) }

// Ms converts a duration to fractional milliseconds.
func Ms(d time.Duration) float64 { return float64(d.Nanoseconds()) / 1e6 }

// Us converts a duration to fractional microseconds.
func Us(d time.Duration) float64 { return float64(d.Nanoseconds()) / 1e3 }

// Rate runs one work function per worker until the deadline and returns the
// summed units per second. newWork is called once per worker before the clock
// starts, so every worker owns its buffers and setup cost stays out of the
// measurement. A work function returns the units it completed (bytes, ops) or
// an error, which aborts the run.
//
// Each worker is one goroutine; with workers == Parallelism() the machine is
// saturated, with workers == 1 a single logical CPU is.
func Rate(ctx context.Context, d time.Duration, workers int, newWork func() func() (int64, error)) (float64, error) {
	if workers < 1 {
		workers = 1
	}
	work := make([]func() (int64, error), workers)
	for i := range work {
		work[i] = newWork()
	}
	// Collect setup garbage now so a collection triggered by it cannot land
	// inside the timed window.
	runtime.GC()

	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		total int64
		first error
	)
	start := time.Now()
	deadline := start.Add(d)
	for _, fn := range work {
		wg.Add(1)
		go func() {
			defer wg.Done()
			var units int64
			var err error
			for err == nil && ctx.Err() == nil && time.Now().Before(deadline) {
				var n int64
				n, err = fn()
				units += n
			}
			mu.Lock()
			total += units
			if err != nil && first == nil {
				first = err
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()
	if first != nil {
		return 0, first
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if elapsed <= 0 {
		return 0, context.DeadlineExceeded
	}
	return float64(total) / elapsed, nil
}
