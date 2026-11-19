package kit

import (
	"context"
	"errors"
	"math"
	"sync/atomic"
	"testing"
	"time"
)

func TestPercentileInterpolatesLikeTheAggregator(t *testing.T) {
	xs := []float64{40, 10, 30, 20}
	for _, tc := range []struct{ p, want float64 }{
		{0, 10}, {50, 25}, {100, 40}, {25, 17.5}, {99, 39.7},
	} {
		if got := Percentile(xs, tc.p); math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("Percentile(%v) = %v, want %v", tc.p, got, tc.want)
		}
	}
	if xs[0] != 40 {
		t.Error("Percentile reordered its input")
	}
	if Percentile(nil, 50) != 0 || Median(nil) != 0 {
		t.Error("empty samples must summarise to zero")
	}
}

func TestMeanAndCV(t *testing.T) {
	if got := Mean([]float64{1, 2, 3, 6}); got != 3 {
		t.Errorf("Mean = %v, want 3", got)
	}
	// stddev of {2,4,4,4,5,5,7,9} with n-1 is ~2.138, mean is 5.
	if got := CV([]float64{2, 4, 4, 4, 5, 5, 7, 9}); math.Abs(got-42.76) > 0.01 {
		t.Errorf("CV = %v, want ~42.76", got)
	}
	if CV([]float64{5}) != 0 || CV([]float64{0, 0}) != 0 {
		t.Error("CV of a single sample or a zero mean must be zero")
	}
}

func TestStealPercent(t *testing.T) {
	before := CPUTicks{Total: 1000, Steal: 10}
	if got := StealPercent(before, CPUTicks{Total: 1200, Steal: 30}); got != 10 {
		t.Errorf("StealPercent = %v, want 10", got)
	}
	if got := StealPercent(before, before); got != 0 {
		t.Errorf("no elapsed ticks must report zero, got %v", got)
	}
	if got := StealPercent(before, CPUTicks{Total: 900, Steal: 5}); got != 0 {
		t.Errorf("a counter that went backwards must report zero, got %v", got)
	}
}

func TestRateSumsUnitsAcrossWorkers(t *testing.T) {
	var setups atomic.Int64
	rate, err := Rate(context.Background(), 50*time.Millisecond, 3, func() func() (int64, error) {
		setups.Add(1)
		return func() (int64, error) {
			time.Sleep(time.Millisecond)
			return 10, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if setups.Load() != 3 {
		t.Errorf("newWork ran %d times, want once per worker", setups.Load())
	}
	// Three workers at ~10 units/ms; scheduling can only make it slower.
	if rate <= 0 || rate > 3*10*1000*1.05 {
		t.Errorf("rate = %v units/s is outside the possible range", rate)
	}
}

func TestRatePropagatesWorkError(t *testing.T) {
	boom := errors.New("wrong answer")
	_, err := Rate(context.Background(), time.Second, 2, func() func() (int64, error) {
		return func() (int64, error) { return 0, boom }
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the work error", err)
	}
}

func TestRateRejectsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Rate(ctx, time.Second, 1, func() func() (int64, error) {
		return func() (int64, error) { return 1, nil }
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
