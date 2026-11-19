//go:build linux

package platform

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func TestExitHelperRunsAndExitsCleanly(t *testing.T) {
	helper, err := exitHelper(runtime.GOARCH)
	if err != nil {
		t.Skipf("no helper for %s", runtime.GOARCH)
	}
	path := filepath.Join(t.TempDir(), "exit0")
	if err := os.WriteFile(path, helper, 0o700); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := spawnAndReap(path); err != nil {
			t.Fatal(err)
		}
	}
	if err := spawnAndReap(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("spawning a missing helper must fail")
	}
}

func TestSpawnCleansUpAndReportsItsContract(t *testing.T) {
	if _, err := exitHelper(runtime.GOARCH); err != nil {
		t.Skipf("no helper for %s", runtime.GOARCH)
	}
	shortRuns(t)
	dir := t.TempDir()
	res, err := (spawnTest{}).Run(context.Background(), bench.Options{Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	metrics := metricsOf(res)
	for _, name := range []string{"process_spawn_p50", "process_spawn_p99"} {
		if m := metrics[name]; m.Unit != "us" || m.HigherIsBetter || m.Value <= 0 {
			t.Errorf("%s metric is wrong: %+v", name, m)
		}
	}
	if metrics["process_spawn_p99"].Value < metrics["process_spawn_p50"].Value {
		t.Error("p99 spawn time is below the median")
	}
	left, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("spawn test left %d entries in its scratch directory", len(left))
	}
}
