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
	"math"
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
	// Outcomes records how each item of a test went, for tests whose metrics
	// are shares of items solved. Each key names one variant of the items (a
	// language in the ai-language suite) and holds one character per item in
	// protocol order: 1 solved, 0 wrong, - no usable answer. Variants share
	// the item order, which is what makes a paired comparison possible
	// afterwards.
	Outcomes map[string]string `json:"outcomes,omitempty"`
	Error    string            `json:"error,omitempty"`
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
	// Duration overrides how long a sustained-profile test runs. Zero keeps
	// the protocol duration; any other value makes the report a pilot that
	// never enters an aggregate.
	Duration time.Duration
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

// Categorized lets a benchmark declare the report category it belongs to.
// Benchmarks without it are compute — the CLI's original suite. A report
// always holds exactly one category, so a run never mixes suites.
type Categorized interface {
	Category() string
}

// CategoryOf returns the category a benchmark reports under.
func CategoryOf(b Benchmark) string {
	if c, ok := b.(Categorized); ok {
		return c.Category()
	}
	return "compute"
}

// Profiled lets a benchmark declare the measurement profile it belongs to.
// Benchmarks without it are standard: the short suite a default run executes.
// A report holds exactly one profile, so long-running tests never ride along
// with — or silently extend — the standard suite.
type Profiled interface {
	Profile() string
}

// ProfileOf returns the profile a benchmark reports under.
func ProfileOf(b Benchmark) string {
	if p, ok := b.(Profiled); ok {
		return p.Profile()
	}
	return StandardProfile
}

// Conditional lets a benchmark that only works on some systems say so. It
// stays registered everywhere, so the catalog of tests does not depend on the
// machine that wrote it. Where it cannot run, no suite includes it and naming
// it fails with the reason.
type Conditional interface {
	// Unavailable returns why the benchmark cannot run here, or "" when it can.
	Unavailable() string
}

// Unavailable returns why a benchmark cannot run on this system, or "".
func Unavailable(b Benchmark) string {
	if c, ok := b.(Conditional); ok {
		return c.Unavailable()
	}
	return ""
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

// Suite returns the registered benchmarks of one category and profile in
// registration order — the set a run executes when no tests are named.
// Benchmarks that cannot run on this system are left out.
func Suite(category, profile string) []Benchmark {
	var out []Benchmark
	for _, b := range registry {
		if CategoryOf(b) == category && ProfileOf(b) == profile && Unavailable(b) == "" {
			out = append(out, b)
		}
	}
	return out
}

// NewResult starts a result for one test, stamped with the current UTC time.
func NewResult(test string) *Result {
	return &Result{Test: test, StartedAt: time.Now().UTC()}
}

// Finish records the elapsed time and rounds every metric to two decimals,
// the precision all published reports share.
func (r *Result) Finish() {
	r.DurationSeconds = round2(time.Since(r.StartedAt).Seconds())
	for i, m := range r.Metrics {
		r.Metrics[i].Value = round2(m.Value)
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// Select resolves test names to benchmarks, erroring on unknown names and on
// tests that cannot run on this system.
func Select(names []string) ([]Benchmark, error) {
	out := make([]Benchmark, 0, len(names))
	for _, n := range names {
		found := false
		for _, b := range registry {
			if b.Name() == n {
				if reason := Unavailable(b); reason != "" {
					return nil, fmt.Errorf("test %q cannot run here: %s", n, reason)
				}
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
