//go:build !linux && !darwin

package kit

// InvoluntarySwitches is not available on this platform.
func InvoluntarySwitches() (int64, bool) { return 0, false }
