//go:build linux

package platform

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

func init() { bench.Register(spawnTest{}) }

// spawnTest starts processes: clone, exec, exit and reap. Shells, build
// systems, CI jobs and git all live on this path, and a sandbox that
// mediates process creation shows it immediately.
//
// The child is a helper of a few dozen bytes whose only instruction is
// exit(0), so nothing but the kernel's process lifecycle is timed. Starting a
// real program instead would mostly measure that program's own start-up.
type spawnTest struct{}

func (spawnTest) Name() string     { return "spawn" }
func (spawnTest) Category() string { return Category }
func (spawnTest) Description() string {
	return "Process creation: clone, exec, exit and reap of a minimal static helper"
}

func (spawnTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("spawn")
	helper, err := exitHelper(runtime.GOARCH)
	if err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
	parent := opts.Dir
	if parent == "" {
		parent = "."
	}
	dir, err := os.MkdirTemp(parent, ".providerbench-spawn-")
	if err != nil {
		return nil, fmt.Errorf("spawn: create scratch directory: %w", err)
	}
	defer os.RemoveAll(dir)
	path, err := filepath.Abs(filepath.Join(dir, "exit0"))
	if err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
	if err := os.WriteFile(path, helper, 0o700); err != nil {
		return nil, fmt.Errorf("spawn: write helper: %w", err)
	}

	for range 20 { // settle the page cache and the kernel's exec caches
		if err := spawnAndReap(path); err != nil {
			return nil, fmt.Errorf("spawn: %w (if %s is mounted noexec, pass --dir)", err, parent)
		}
	}

	d := pick(opts, 3*time.Second, time.Second)
	opts.Logf("spawn: starting processes back to back (%s)...", d)
	var times []float64
	start := time.Now()
	for time.Since(start) < d && ctx.Err() == nil {
		began := time.Now()
		if err := spawnAndReap(path); err != nil {
			return nil, fmt.Errorf("spawn: %w", err)
		}
		times = append(times, kit.Us(time.Since(began)))
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
	if len(times) < 10 {
		return nil, errors.New("spawn: fewer than 10 processes completed")
	}

	res.Add("process_spawn_p50", kit.Percentile(times, 50), "us", false)
	res.Add("process_spawn_p99", kit.Percentile(times, 99), "us", false)
	res.Note("%d sequential spawns of a %d-byte static helper that only calls exit(0)", len(times), len(helper))
	res.Finish()
	return res, ctx.Err()
}

// spawnAndReap starts the helper and waits for it, using the system calls
// directly: no pipes, no goroutines, no /dev/null handles.
func spawnAndReap(path string) error {
	pid, err := syscall.ForkExec(path, []string{path}, &syscall.ProcAttr{
		Files: []uintptr{0, 1, 2},
	})
	if err != nil {
		return fmt.Errorf("start helper: %w", err)
	}
	var status syscall.WaitStatus
	for {
		_, err = syscall.Wait4(pid, &status, 0, nil)
		if err != syscall.EINTR {
			break
		}
	}
	if err != nil {
		return fmt.Errorf("wait for helper: %w", err)
	}
	if !status.Exited() || status.ExitStatus() != 0 {
		return fmt.Errorf("helper did not exit cleanly (status %#x)", uint32(status))
	}
	return nil
}
