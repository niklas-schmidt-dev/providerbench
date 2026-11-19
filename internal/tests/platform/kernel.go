package platform

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

func init() { bench.Register(kernelTest{}) }

// kernelTest times the four kernel paths a process leans on constantly:
// entering the kernel, waking another thread, getting fresh memory and
// reading the clock.
type kernelTest struct{}

func (kernelTest) Name() string     { return "kernel" }
func (kernelTest) Category() string { return Category }
func (kernelTest) Description() string {
	return "Kernel path costs: system call, thread wake-up, first-touch memory and clock read"
}

const firstTouchBytes = 64 << 20

func (kernelTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("kernel")
	d := pick(opts, 1500*time.Millisecond, 500*time.Millisecond)

	if kernelProbes {
		opts.Logf("kernel: system call cost (%s)...", d)
		res.Add("syscall", syscallCost(ctx, d), "ns", false)

		opts.Logf("kernel: thread wake-up over a pipe (%s)...", d)
		roundTrip, err := pipeRoundTrip(ctx, d)
		if err != nil {
			return nil, fmt.Errorf("kernel: pipe round trip: %w", err)
		}
		res.Add("pipe_roundtrip", roundTrip, "us", false)

		opts.Logf("kernel: first-touch memory, %d MiB mappings (%s)...", firstTouchBytes>>20, d)
		gbps, pageSize, err := firstTouch(ctx, d, firstTouchBytes)
		if err != nil {
			return nil, fmt.Errorf("kernel: first-touch memory: %w", err)
		}
		res.Add("memory_first_touch", gbps, "GB/s", true)
		res.Note("first-touch memory uses %d KiB pages; transparent huge pages are declined where the kernel allows", pageSize>>10)
	} else {
		res.Note("system call, thread wake-up and first-touch probes are implemented for Linux and macOS only")
	}

	opts.Logf("kernel: clock read cost (%s)...", d)
	res.Add("clock_read", clockCost(ctx, d), "ns", false)
	if source := kit.Clocksource(); source != "" {
		res.Note("kernel clocksource: %s", source)
	}
	res.Note("%s/%s; every probe is one thread unless stated", runtime.GOOS, runtime.GOARCH)
	res.Finish()
	return res, ctx.Err()
}

// clockCost returns the nanoseconds one monotonic clock read takes. With a
// usable vDSO clocksource this is tens of nanoseconds; when the platform
// forces a real system call for every read it is ten times that, and every
// timestamp, timeout and trace span in a service pays it.
func clockCost(ctx context.Context, d time.Duration) float64 {
	const batch = 1000
	var reads int64
	start := time.Now()
	last := start
	for last.Sub(start) < d && ctx.Err() == nil {
		for range batch {
			last = time.Now()
		}
		reads += batch
	}
	return float64(last.Sub(start).Nanoseconds()) / float64(reads)
}
