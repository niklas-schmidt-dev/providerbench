package platform

import "github.com/niklas-schmidt-dev/providerbench/internal/bench"

func init() { bench.Register(spawnTest{}) }

// spawnTest starts processes: clone, exec, exit and reap. Shells, build
// systems, CI jobs and git all live on this path, and a sandbox that
// mediates process creation shows it immediately.
//
// The child is a helper of a few dozen bytes whose only instruction is
// exit(0), so nothing but the kernel's process lifecycle is timed. Starting a
// real program instead would mostly measure that program's own start-up.
//
// The helper is a Linux executable, so the test runs on Linux only. It is
// registered everywhere all the same: the list of tests, and with it
// data/catalog.json, must not depend on the machine that wrote it.
type spawnTest struct{}

func (spawnTest) Name() string     { return "spawn" }
func (spawnTest) Category() string { return Category }
func (spawnTest) Description() string {
	return "Process creation: clone, exec, exit and reap of a minimal static helper"
}
