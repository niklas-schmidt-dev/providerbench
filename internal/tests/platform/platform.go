// Package platform measures what the layer underneath a workload costs: the
// kernel, the hypervisor or sandbox, and the filesystem. Two machines with
// identical CPUs can differ several times over here — a system call that
// leaves the guest, a page fault resolved by a userspace kernel, a process
// started through a sandbox shim, a vCPU that is silently descheduled.
//
// None of these appear in a throughput benchmark that stays inside one
// process, which is why they form their own suite.
package platform

import (
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// Category is the report category every test in this package belongs to.
const Category = "platform"

// Options is an alias so test files read naturally.
type Options = bench.Options

// durationOverride shortens every measurement in unit tests; it is zero in
// the benchmark binary.
var durationOverride time.Duration

// pick returns how long a measurement runs: full, or quick with --quick.
func pick(opts Options, full, quick time.Duration) time.Duration {
	if durationOverride > 0 {
		return durationOverride
	}
	return opts.Pick(full, quick)
}
