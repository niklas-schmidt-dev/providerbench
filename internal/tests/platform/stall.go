package platform

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

func init() { bench.Register(stallTest{}) }

// stallTest detects time a busy thread did not get to run. Every logical CPU
// spins reading the clock; a jump between two consecutive reads is time the
// thread was off the CPU.
//
// The kernel's steal counter answers the same question only when the
// hypervisor chooses to report it. Many platforms report zero by design, and
// a CPU quota enforced by a container runtime never appears there at all.
// A gap in the clock cannot be hidden: it is measured from inside the
// workload.
type stallTest struct{}

func (stallTest) Name() string     { return "stall" }
func (stallTest) Category() string { return Category }
func (stallTest) Description() string {
	return "Scheduling stalls on busy CPUs: lost time, longest stall and stall rate, however the platform reports steal"
}

const (
	// A gap this long is not an interrupt or a timer tick: the thread lost
	// the CPU.
	stallLost = 100 * time.Microsecond
	// A gap this long is counted as one stall event.
	stallEvent = time.Millisecond
)

type stallStats struct {
	lost    time.Duration
	longest time.Duration
	events  int64
	ran     time.Duration
}

// observe accounts for the time between two consecutive clock reads.
func (s *stallStats) observe(gap time.Duration) {
	if gap < stallLost {
		return
	}
	s.lost += gap
	s.longest = max(s.longest, gap)
	if gap >= stallEvent {
		s.events++
	}
}

// merge folds another thread's observations into s.
func (s *stallStats) merge(other stallStats) {
	s.lost += other.lost
	s.ran += other.ran
	s.events += other.events
	s.longest = max(s.longest, other.longest)
}

// spin reads the clock in a tight loop for d and records every gap. It
// allocates nothing, so the garbage collector has no reason to interrupt it.
func spin(ctx context.Context, d time.Duration) stallStats {
	var s stallStats
	start := time.Now()
	last := start
	for batch := 0; ; batch++ {
		var now time.Time
		for range 256 {
			now = time.Now()
			s.observe(now.Sub(last))
			last = now
		}
		if s.ran = now.Sub(start); s.ran >= d {
			return s
		}
		// Cancellation is checked about once a millisecond: the spinners
		// share the context, and touching it more often would make them
		// interfere with each other.
		if batch&63 == 0 && ctx.Err() != nil {
			return s
		}
	}
}

func (stallTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("stall")
	d := pick(opts, 10*time.Second, 3*time.Second)
	cores := kit.Parallelism()
	opts.Logf("stall: watching the clock on %d busy cores (%s)...", cores, d)

	// A collection during the window would look like a stall on every core.
	runtime.GC()
	ticksBefore, ticksOK := kit.ReadCPUTicks()
	switchesBefore, switchesOK := kit.InvoluntarySwitches()
	waitBefore, waitOK := kit.RunqueueWait()

	stats := make([]stallStats, cores)
	var wg sync.WaitGroup
	for i := range stats {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stats[i] = spin(ctx, d)
		}()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("stall: %w", err)
	}
	ticksAfter, ticksAfterOK := kit.ReadCPUTicks()
	switchesAfter, _ := kit.InvoluntarySwitches()
	waitAfter, waitAfterOK := kit.RunqueueWait()

	var total stallStats
	for _, s := range stats {
		total.merge(s)
	}
	if total.ran <= 0 {
		return nil, errors.New("stall: no thread ran")
	}

	res.Add("lost_time", float64(total.lost)/float64(total.ran)*100, "%", false)
	res.Add("longest_stall", kit.Ms(total.longest), "ms", false)
	res.Add("stall_rate", float64(total.events)/total.ran.Minutes(), "per core-minute", false)
	if ticksOK && ticksAfterOK {
		res.Add("reported_steal", kit.StealPercent(ticksBefore, ticksAfter), "%", false)
	} else {
		res.Note("reported_steal needs /proc/stat and is only available on Linux")
	}
	// runqueue_wait is the part of the lost time the guest kernel knows
	// about: its own scheduler ran something else. What remains of lost_time
	// happened below the guest.
	if waitOK && waitAfterOK && waitAfter >= waitBefore {
		res.Add("runqueue_wait", float64(waitAfter-waitBefore)/float64(total.ran)*100, "%", false)
	} else {
		res.Note("runqueue_wait needs /proc/self/task/*/schedstat and is only available on Linux")
	}
	// Only Linux counts exactly the preemptions meant here; other kernels
	// fold unrelated events into the same counter.
	if switchesOK && runtime.GOOS == "linux" {
		res.Note("the guest kernel preempted the benchmark %d times in the window", switchesAfter-switchesBefore)
	}
	res.Note("lost_time sums clock gaps of %s or more on %d spinning threads; stall_rate counts gaps of %s or more", stallLost, cores, stallEvent)
	res.Finish()
	return res, ctx.Err()
}
