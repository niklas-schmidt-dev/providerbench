// Package tests contains the built-in benchmarks. Each test lives in its own
// file, implements bench.Benchmark and registers itself in init — add new
// tests the same way.
package tests

import (
	"math"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// Options is an alias so test files read naturally.
type Options = bench.Options

func newResult(name string) *bench.Result {
	return &bench.Result{Test: name, StartedAt: time.Now().UTC()}
}

func finish(r *bench.Result) {
	r.DurationSeconds = round2(time.Since(r.StartedAt).Seconds())
	for i, m := range r.Metrics {
		r.Metrics[i].Value = round2(m.Value)
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// median returns the middle value of a sorted-or-unsorted sample.
func median(xs []float64) float64 {
	return percentile(xs, 50)
}

func percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := make([]float64, len(xs))
	copy(sorted, xs)
	for i := 1; i < len(sorted); i++ { // insertion sort, samples are small
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	idx := p / 100 * float64(len(sorted)-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sum := 0.0
	for _, x := range xs {
		sum += x
	}
	return sum / float64(len(xs))
}

// coefficientOfVariation returns stddev/mean as a percentage.
func coefficientOfVariation(xs []float64) float64 {
	m := mean(xs)
	if m == 0 || len(xs) < 2 {
		return 0
	}
	varSum := 0.0
	for _, x := range xs {
		varSum += (x - m) * (x - m)
	}
	return math.Sqrt(varSum/float64(len(xs)-1)) / m * 100
}
