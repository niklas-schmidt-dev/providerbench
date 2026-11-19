//go:build linux || darwin

package kit

import "syscall"

// InvoluntarySwitches returns how often the kernel has preempted this
// process's threads so far.
func InvoluntarySwitches() (int64, bool) {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return 0, false
	}
	return int64(usage.Nivcsw), true
}
