package platform

import (
	"context"
	"encoding/binary"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func shortRuns(t *testing.T) {
	t.Helper()
	durationOverride = 60 * time.Millisecond
	t.Cleanup(func() { durationOverride = 0 })
}

func metricsOf(res *bench.Result) map[string]bench.Metric {
	out := make(map[string]bench.Metric, len(res.Metrics))
	for _, m := range res.Metrics {
		out[m.Name] = m
	}
	return out
}

func TestStallAccountingSeparatesNoiseLostTimeAndEvents(t *testing.T) {
	var s stallStats
	for _, gap := range []time.Duration{
		40 * time.Nanosecond,   // an ordinary clock read
		99 * time.Microsecond,  // an interrupt: below the lost-time floor
		100 * time.Microsecond, // lost, but not a stall event
		999 * time.Microsecond, // lost, but not a stall event
		time.Millisecond,       // a stall event
		30 * time.Millisecond,  // a stall event, and the longest
	} {
		s.observe(gap)
	}
	if want := 100*time.Microsecond + 999*time.Microsecond + 31*time.Millisecond; s.lost != want {
		t.Errorf("lost = %s, want %s", s.lost, want)
	}
	if s.events != 2 {
		t.Errorf("events = %d, want 2", s.events)
	}
	if s.longest != 30*time.Millisecond {
		t.Errorf("longest = %s, want 30ms", s.longest)
	}

	other := stallStats{lost: time.Second, longest: time.Second, events: 1, ran: 10 * time.Second}
	s.ran = 10 * time.Second
	s.merge(other)
	if s.ran != 20*time.Second || s.events != 3 || s.longest != time.Second {
		t.Errorf("merge lost information: %+v", s)
	}
}

func TestSpinRunsForItsDurationAndStopsOnCancel(t *testing.T) {
	s := spin(context.Background(), 30*time.Millisecond)
	if s.ran < 30*time.Millisecond || s.ran > 2*time.Second {
		t.Errorf("spin ran for %s, want about 30ms", s.ran)
	}
	if s.lost > s.ran {
		t.Errorf("lost time %s exceeds run time %s", s.lost, s.ran)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s := spin(ctx, time.Minute); s.ran > 5*time.Second {
		t.Errorf("spin ignored cancellation for %s", s.ran)
	}
}

func TestStallReportsItsContract(t *testing.T) {
	shortRuns(t)
	res, err := (stallTest{}).Run(context.Background(), bench.Options{})
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsOf(res)
	for name, unit := range map[string]string{
		"lost_time": "%", "longest_stall": "ms", "stall_rate": "per core-minute",
	} {
		m, ok := metrics[name]
		if !ok || m.Unit != unit || m.HigherIsBetter || m.Value < 0 {
			t.Errorf("%s metric is wrong: %+v (present %v)", name, m, ok)
		}
	}
	if metrics["lost_time"].Value > 100 {
		t.Errorf("lost_time = %v%%, cannot exceed 100", metrics["lost_time"].Value)
	}
	linux := runtime.GOOS == "linux"
	if _, steal := metrics["reported_steal"]; steal != linux {
		t.Errorf("reported_steal present = %v, must exist exactly on Linux", steal)
	}
	// A Linux kernel may keep no scheduler statistics; the note then says so.
	_, wait := metrics["runqueue_wait"]
	explained := strings.Contains(strings.Join(res.Notes, "\n"), "runqueue_wait needs")
	if wait == explained || (wait && !linux) {
		t.Errorf("runqueue_wait present = %v, explained as missing = %v", wait, explained)
	}
}

func TestKernelReportsItsContract(t *testing.T) {
	shortRuns(t)
	res, err := (kernelTest{}).Run(context.Background(), bench.Options{})
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsOf(res)
	if m := metrics["clock_read"]; m.Unit != "ns" || m.HigherIsBetter || m.Value <= 0 {
		t.Errorf("clock_read metric is wrong: %+v", m)
	}
	if !kernelProbes {
		if len(metrics) != 1 {
			t.Errorf("platforms without kernel probes report clock_read only, got %+v", res.Metrics)
		}
		return
	}
	for name, unit := range map[string]string{"syscall": "ns", "pipe_roundtrip": "us"} {
		if m := metrics[name]; m.Unit != unit || m.HigherIsBetter || m.Value <= 0 {
			t.Errorf("%s metric is wrong: %+v", name, m)
		}
	}
	if m := metrics["memory_first_touch"]; m.Unit != "GB/s" || !m.HigherIsBetter || m.Value <= 0 {
		t.Errorf("memory_first_touch metric is wrong: %+v", m)
	}
	// A round trip is two wake-ups and four system calls, so it cannot cost
	// less than a single call.
	if metrics["pipe_roundtrip"].Value*1000 < metrics["syscall"].Value {
		t.Errorf("pipe round trip (%v us) is cheaper than one system call (%v ns)",
			metrics["pipe_roundtrip"].Value, metrics["syscall"].Value)
	}
}

func TestFilesCleansUpAndReportsItsContract(t *testing.T) {
	shortRuns(t)
	dir := t.TempDir()
	res, err := (filesTest{}).Run(context.Background(), bench.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsOf(res)
	for _, name := range []string{"file_create", "file_read", "file_delete"} {
		if m := metrics[name]; m.Unit != "ops/s" || !m.HigherIsBetter || m.Value <= 0 {
			t.Errorf("%s metric is wrong: %+v", name, m)
		}
	}
	left, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("files test left %d entries in its scratch directory", len(left))
	}
}

func TestFilesFailsInAMissingDirectory(t *testing.T) {
	shortRuns(t)
	if _, err := (filesTest{}).Run(context.Background(), bench.Options{Dir: "/nonexistent/providerbench"}); err == nil {
		t.Fatal("a missing scratch directory must fail the test")
	}
}

func TestExitHelperIsAWellFormedExecutable(t *testing.T) {
	for arch, machine := range map[string]uint16{"amd64": 0x3e, "arm64": 0xb7} {
		elf, err := exitHelper(arch)
		if err != nil {
			t.Fatalf("%s: %v", arch, err)
		}
		le := binary.LittleEndian
		if string(elf[:4]) != "\x7fELF" || elf[4] != 2 || elf[5] != 1 {
			t.Errorf("%s: not a little-endian ELF64 header", arch)
		}
		if got := le.Uint16(elf[18:]); got != machine {
			t.Errorf("%s: e_machine = %#x, want %#x", arch, got, machine)
		}
		const header, program, load = 64, 56, 0x400000
		if entry := le.Uint64(elf[24:]); entry != load+header+program {
			t.Errorf("%s: entry point %#x does not point at the code", arch, entry)
		}
		if phoff := le.Uint64(elf[32:]); phoff != header {
			t.Errorf("%s: program header offset = %d, want %d", arch, phoff, header)
		}
		// The single segment must cover exactly the file.
		if filesz := le.Uint64(elf[header+32:]); filesz != uint64(len(elf)) {
			t.Errorf("%s: segment size %d does not match the %d-byte file", arch, filesz, len(elf))
		}
		if len(elf) <= header+program {
			t.Errorf("%s: helper carries no code", arch)
		}
	}
	if _, err := exitHelper("riscv64"); err == nil {
		t.Error("an architecture without a helper must be an error, not an empty file")
	}
}
