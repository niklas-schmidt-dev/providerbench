//go:build linux

package kit

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// RunqueueWait returns the total time this process's threads have spent
// runnable but waiting for a CPU inside the guest, from the kernel's
// per-thread scheduler statistics. Time the hypervisor took away is not in
// it: to the guest kernel a descheduled vCPU still looks like a running one.
func RunqueueWait() (time.Duration, bool) {
	paths, err := filepath.Glob("/proc/self/task/*/schedstat")
	if err != nil || len(paths) == 0 {
		return 0, false
	}
	var total time.Duration
	var onCPU int64
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue // the thread exited between the listing and the read
		}
		// Fields: time on CPU (ns), time waiting on a run queue (ns), timeslices.
		fields := strings.Fields(string(data))
		if len(fields) < 2 {
			return 0, false
		}
		ran, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			return 0, false
		}
		wait, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			return 0, false
		}
		onCPU += ran
		total += time.Duration(wait)
	}
	// A kernel without scheduler accounting prints zeros for every thread.
	// No time on CPU means there are no statistics, not that nothing waited.
	return total, onCPU > 0
}
