package compute

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// The sustained profile answers what a short run cannot: is the performance
// measured in the first seconds still there after ten minutes? Burstable
// plans, CPU-credit schemes, fair-share throttling and storage burst buckets
// all look perfect in a three-second test.

const (
	sustainedWindow      = 10 * time.Second
	sustainedInitial     = 3 // windows averaged for the initial rate (30 s)
	sustainedFinal       = 6 // windows averaged for the sustained rate (60 s)
	sustainedDropPercent = 80
)

// sustainedDuration resolves the run length: the protocol default unless the
// caller asked for a pilot, and never shorter than the windows the metrics
// are defined over.
func sustainedDuration(opts Options, standard time.Duration) (time.Duration, error) {
	d := standard
	if opts.Duration > 0 {
		d = opts.Duration
	}
	if d < bench.MinSustainedDuration {
		return 0, fmt.Errorf("sustained tests need at least %s", bench.MinSustainedDuration)
	}
	return d, nil
}

// sampleWindows reads a monotonically increasing counter at every window
// boundary until the deadline and returns the per-second rate of each window.
func sampleWindows(ctx context.Context, total, window time.Duration, counter func() int64) ([]float64, error) {
	count := int(total / window)
	if count < 1 || window <= 0 {
		return nil, errors.New("sustained workload has no complete window")
	}
	rates := make([]float64, 0, count)
	ticker := time.NewTicker(window)
	defer ticker.Stop()
	lastAt := time.Now()
	lastValue := counter()
	for len(rates) < count {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
			// Read the clock here, not from the tick: with every CPU busy
			// this goroutine can be scheduled late, and the counter must be
			// paired with the moment it was actually read.
			now := time.Now()
			value := counter()
			if elapsed := now.Sub(lastAt).Seconds(); elapsed > 0 {
				rates = append(rates, float64(value-lastValue)/elapsed)
			}
			lastAt, lastValue = now, value
		}
	}
	return rates, nil
}

type sustainedSummary struct {
	initial     float64 // mean rate of the first windows
	sustained   float64 // mean rate of the final windows
	retained    float64 // sustained / initial, percent
	worstWindow float64 // slowest window / median window, percent
	windowCV    float64 // coefficient of variation across windows, percent
	dropAfter   time.Duration
	dropped     bool
}

// summarizeWindows reduces a window trace to the published numbers. It needs
// distinct initial and final segments, so callers must supply at least
// sustainedInitial+sustainedFinal windows.
func summarizeWindows(rates []float64, window time.Duration) (sustainedSummary, error) {
	if len(rates) < sustainedInitial+sustainedFinal {
		return sustainedSummary{}, fmt.Errorf("need %d windows, measured %d", sustainedInitial+sustainedFinal, len(rates))
	}
	s := sustainedSummary{
		initial:   mean(rates[:sustainedInitial]),
		sustained: mean(rates[len(rates)-sustainedFinal:]),
		windowCV:  coefficientOfVariation(rates),
	}
	if s.initial <= 0 {
		return sustainedSummary{}, errors.New("no work completed in the initial windows")
	}
	s.retained = s.sustained / s.initial * 100
	if mid := median(rates); mid > 0 {
		slowest := rates[0]
		for _, rate := range rates {
			slowest = min(slowest, rate)
		}
		s.worstWindow = slowest / mid * 100
	}
	// A drop is a window after the initial segment that falls below it. A
	// slow first window is a warm-up, not a throttle: it lowers the initial
	// rate it is part of, and worst_window already reports it.
	for i := sustainedInitial; i < len(rates); i++ {
		if rates[i] < s.initial*sustainedDropPercent/100 {
			s.dropAfter = time.Duration(i) * window
			s.dropped = true
			break
		}
	}
	return s, nil
}

// noteWindows records the full trace, so a reader can see the shape of a
// throttle and not only its summary.
func noteWindows(res *bench.Result, label string, rates []float64, window time.Duration, s sustainedSummary) {
	parts := make([]string, len(rates))
	for i, rate := range rates {
		parts[i] = strconv.FormatFloat(rate, 'f', 0, 64)
	}
	res.Note("%s per %s window: %s", label, window, strings.Join(parts, " "))
	if s.dropped {
		res.Note("first window below %d%% of the initial rate started after %s", sustainedDropPercent, s.dropAfter)
	} else {
		res.Note("no window after the initial %d fell below %d%% of the initial rate", sustainedInitial, sustainedDropPercent)
	}
}

func addSustainedMetrics(res *bench.Result, prefix, unit string, s sustainedSummary) {
	res.Add("initial_"+prefix, s.initial, unit, true)
	res.Add("sustained_"+prefix, s.sustained, unit, true)
	res.Add("retained", s.retained, "%", true)
	res.Add("worst_window", s.worstWindow, "%", true)
	res.Add("window_cv", s.windowCV, "%", false)
}
