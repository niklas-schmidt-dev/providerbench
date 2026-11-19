package compute

import (
	"context"
	"errors"
	"io"
	"math"
	"os"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func steady(n int, rate float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = rate
	}
	return out
}

func TestSummarizeWindowsOnASteadyMachine(t *testing.T) {
	s, err := summarizeWindows(steady(60, 3500), 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if s.initial != 3500 || s.sustained != 3500 || s.retained != 100 || s.worstWindow != 100 || s.windowCV != 0 {
		t.Errorf("steady trace summarised as %+v", s)
	}
	if s.dropped {
		t.Error("steady trace reported a drop")
	}
}

// The shape the profile exists for: full speed until a credit balance runs
// out, then a fraction of it.
func TestSummarizeWindowsFindsABurstCliff(t *testing.T) {
	rates := append(steady(18, 4000), steady(42, 800)...)
	s, err := summarizeWindows(rates, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if s.initial != 4000 || s.sustained != 800 {
		t.Errorf("initial %v / sustained %v, want 4000 / 800", s.initial, s.sustained)
	}
	if s.retained != 20 {
		t.Errorf("retained = %v%%, want 20", s.retained)
	}
	if !s.dropped || s.dropAfter != 180*time.Second {
		t.Errorf("drop reported at %v (found %v), want after 3m0s", s.dropAfter, s.dropped)
	}
	// The median window is already throttled, so the worst window equals it.
	if s.worstWindow != 100 {
		t.Errorf("worst window = %v%%, want 100", s.worstWindow)
	}
}

func TestSummarizeWindowsReportsASingleDip(t *testing.T) {
	rates := steady(30, 1000)
	rates[14] = 400
	s, err := summarizeWindows(rates, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if s.retained != 100 {
		t.Errorf("a dip in the middle must not change retained, got %v%%", s.retained)
	}
	if s.worstWindow != 40 {
		t.Errorf("worst window = %v%%, want 40", s.worstWindow)
	}
	if !s.dropped || s.dropAfter != 140*time.Second {
		t.Errorf("dip reported at %v (found %v), want after 2m20s", s.dropAfter, s.dropped)
	}
}

// A device that ramps up is not being throttled.
func TestSummarizeWindowsDoesNotCallAWarmUpADrop(t *testing.T) {
	rates := append([]float64{600, 1000, 1000}, steady(12, 1000)...)
	s, err := summarizeWindows(rates, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if s.dropped {
		t.Errorf("a slow first window was reported as a drop after %v", s.dropAfter)
	}
	if s.worstWindow != 60 {
		t.Errorf("worst window = %v%%, want 60: the warm-up must stay visible there", s.worstWindow)
	}
	if s.retained <= 100 {
		t.Errorf("retained = %v%%, want above 100 after a warm-up", s.retained)
	}
}

func TestSummarizeWindowsNeedsDistinctSegments(t *testing.T) {
	if _, err := summarizeWindows(steady(sustainedInitial+sustainedFinal-1, 100), time.Second); err == nil {
		t.Error("too few windows must be rejected: initial and sustained would overlap")
	}
	if _, err := summarizeWindows(steady(20, 0), time.Second); err == nil {
		t.Error("a trace with no completed work must be rejected")
	}
}

func TestSustainedDurationHonoursPilotsAndTheMinimum(t *testing.T) {
	if d, err := sustainedDuration(Options{}, 10*time.Minute); err != nil || d != 10*time.Minute {
		t.Errorf("default duration = %v, %v", d, err)
	}
	if d, err := sustainedDuration(Options{Duration: 2 * time.Minute}, 10*time.Minute); err != nil || d != 2*time.Minute {
		t.Errorf("pilot duration = %v, %v", d, err)
	}
	if _, err := sustainedDuration(Options{Duration: 30 * time.Second}, 10*time.Minute); err == nil {
		t.Error("a run shorter than the summarised windows must be rejected")
	}
	// The published minimum is exactly the windows the metrics are built on.
	if want := time.Duration(sustainedInitial+sustainedFinal) * sustainedWindow; bench.MinSustainedDuration != want {
		t.Errorf("bench.MinSustainedDuration = %s, but the summary needs %s", bench.MinSustainedDuration, want)
	}
}

func TestSampleWindowsMeasuresRatePerWindow(t *testing.T) {
	var counter atomic.Int64
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		ticker := time.NewTicker(time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				counter.Add(100)
			}
		}
	}()
	rates, err := sampleWindows(context.Background(), 200*time.Millisecond, 20*time.Millisecond, counter.Load)
	if err != nil {
		t.Fatal(err)
	}
	if len(rates) != 10 {
		t.Fatalf("got %d windows, want 10", len(rates))
	}
	// ~100 units per millisecond; a loaded test machine can only be slower.
	if got := mean(rates); got <= 0 || got > 110_000 {
		t.Errorf("mean rate = %v units/s, want at most ~100000", got)
	}
}

func TestSampleWindowsRejectsCancellationAndEmptyPlans(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := sampleWindows(ctx, time.Second, 100*time.Millisecond, func() int64 { return 0 }); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
	if _, err := sampleWindows(context.Background(), time.Millisecond, time.Second, func() int64 { return 0 }); err == nil {
		t.Error("a total shorter than one window must be rejected")
	}
}

func metricsByName(res *bench.Result) map[string]bench.Metric {
	out := make(map[string]bench.Metric, len(res.Metrics))
	for _, m := range res.Metrics {
		out[m.Name] = m
	}
	return out
}

func TestCPUSustainedReportsItsContract(t *testing.T) {
	res, err := runCPUSustained(context.Background(), Options{}, 300*time.Millisecond, 20*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsByName(res)
	for name, unit := range map[string]string{
		"initial_throughput": "MB/s", "sustained_throughput": "MB/s", "retained": "%", "worst_window": "%",
	} {
		if m := metrics[name]; m.Unit != unit || !m.HigherIsBetter || m.Value <= 0 {
			t.Errorf("%s metric is wrong: %+v", name, m)
		}
	}
	if m, ok := metrics["window_cv"]; !ok || m.Unit != "%" || m.HigherIsBetter {
		t.Errorf("window_cv metric is wrong: %+v", m)
	}
	if _, ok := metrics["cpu_steal"]; ok != (runtime.GOOS == "linux") {
		t.Errorf("cpu_steal present = %v; it must exist exactly on Linux", ok)
	}
	if notes := strings.Join(res.Notes, "\n"); !strings.Contains(notes, "MB/s per 20ms window:") {
		t.Errorf("the window trace is missing from the notes: %q", notes)
	}
}

func TestSustainedTestsDeclareTheirProfile(t *testing.T) {
	for _, b := range []bench.Benchmark{cpuSustainedTest{}, diskSustainedTest{}} {
		if bench.ProfileOf(b) != bench.SustainedProfile || bench.CategoryOf(b) != "compute" {
			t.Errorf("%s is registered as %s/%s", b.Name(), bench.CategoryOf(b), bench.ProfileOf(b))
		}
	}
	// The standard compute suite is frozen at five tests by compute-v2.
	var names []string
	for _, b := range bench.Suite("compute", bench.StandardProfile) {
		names = append(names, b.Name())
	}
	if got := strings.Join(names, ","); got != "cpu,disk,memory,network,steal" {
		t.Errorf("standard compute suite is %q; sustained tests must not join it", got)
	}
}

func TestDiskSustainedReportsItsContractAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	res, err := runDiskSustained(context.Background(), Options{Dir: dir}, 300*time.Millisecond, 20*time.Millisecond, 2*diskBlock)
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsByName(res)
	for _, name := range []string{"initial_write_iops", "sustained_write_iops"} {
		if m := metrics[name]; m.Unit != "IOPS" || !m.HigherIsBetter || m.Value <= 0 {
			t.Errorf("%s metric is wrong: %+v", name, m)
		}
	}
	if left, err := os.ReadDir(dir); err != nil || len(left) != 0 {
		t.Errorf("disk_sustained left %d entries in its scratch directory (%v)", len(left), err)
	}
}

type failingWriter struct {
	failAt int64
	short  bool
	writes atomic.Int64
}

func (w *failingWriter) WriteAt(p []byte, off int64) (int, error) {
	if off%diskAlign != 0 || len(p) != diskAlign {
		return 0, errors.New("unaligned write")
	}
	if w.writes.Add(1) == w.failAt {
		if w.short {
			return len(p) / 2, nil
		}
		return 0, errors.New("device error")
	}
	return len(p), nil
}

func TestRandomWritesPropagatesDeviceErrors(t *testing.T) {
	var counted atomic.Int64
	err := randomWrites(context.Background(), &failingWriter{failAt: 5}, 1024, 1, &counted)
	if err == nil || err.Error() != "device error" {
		t.Fatalf("err = %v, want the device error", err)
	}
	if counted.Load() != 4 {
		t.Errorf("counted %d writes, want only the 4 that succeeded", counted.Load())
	}
	if err := randomWrites(context.Background(), &failingWriter{failAt: 2, short: true}, 1024, 1, &counted); !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("err = %v, want io.ErrShortWrite", err)
	}
}

func TestRandomWritesStopsWithItsContext(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	var counted atomic.Int64
	if err := randomWrites(ctx, &failingWriter{failAt: math.MaxInt64}, 1024, 1, &counted); err != nil {
		t.Fatalf("cancellation is the normal end of the workload, got %v", err)
	}
	if counted.Load() == 0 {
		t.Error("no write was counted before the deadline")
	}
}
