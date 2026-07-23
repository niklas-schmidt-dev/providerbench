// Package bench provides the benchmark framework: the Benchmark interface,
// the registry, and the result types shared by all tests.
//
// To add a new test, implement Benchmark in a file under internal/tests and
// call Register from an init function. It is then automatically available in
// `providerbench run` and `providerbench list`.
package bench

import (
	"context"
	"fmt"
	"time"
)

// Metric is a single measured value produced by a benchmark.
type Metric struct {
	Name           string  `json:"name"`
	Value          float64 `json:"value"`
	Unit           string  `json:"unit"`
	HigherIsBetter bool    `json:"higher_is_better"`
}

// Result is the outcome of one benchmark run.
type Result struct {
	Test            string    `json:"test"`
	StartedAt       time.Time `json:"started_at"`
	DurationSeconds float64   `json:"duration_seconds"`
	Metrics         []Metric  `json:"metrics"`
	Notes           []string  `json:"notes,omitempty"`
	Error           string    `json:"error,omitempty"`
}

func (r *Result) Add(name string, value float64, unit string, higherIsBetter bool) {
	r.Metrics = append(r.Metrics, Metric{Name: name, Value: value, Unit: unit, HigherIsBetter: higherIsBetter})
}

func (r *Result) Note(format string, a ...any) {
	r.Notes = append(r.Notes, fmt.Sprintf(format, a...))
}

// Options are passed to every benchmark run.
type Options struct {
	Quick bool                          // shorter, less precise runs
	Dir   string                        // scratch directory for disk tests ("" = current directory)
	Log   func(format string, a ...any) // progress output, may be nil
}

func (o Options) Logf(format string, a ...any) {
	if o.Log != nil {
		o.Log(format, a...)
	}
}

// Pick returns full unless Quick is set.
func (o Options) Pick(full, quick time.Duration) time.Duration {
	if o.Quick {
		return quick
	}
	return full
}

// Benchmark is the interface every test implements.
type Benchmark interface {
	Name() string        // short id, e.g. "cpu"
	Description() string // one line shown in `providerbench list`
	Run(ctx context.Context, opts Options) (*Result, error)
}

var registry []Benchmark

// Register adds a benchmark to the global registry. Call it from an init
// function; duplicate names panic at startup.
func Register(b Benchmark) {
	for _, r := range registry {
		if r.Name() == b.Name() {
			panic("bench: duplicate benchmark " + b.Name())
		}
	}
	registry = append(registry, b)
}

// All returns registered benchmarks in registration order.
func All() []Benchmark {
	return registry
}

// Select resolves test names to benchmarks, erroring on unknown names.
func Select(names []string) ([]Benchmark, error) {
	out := make([]Benchmark, 0, len(names))
	for _, n := range names {
		found := false
		for _, b := range registry {
			if b.Name() == n {
				out = append(out, b)
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown test %q (run `providerbench list`)", n)
		}
	}
	return out, nil
}
