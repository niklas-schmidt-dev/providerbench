//go:build !linux

package kit

import "time"

// RunqueueWait is only available on Linux.
func RunqueueWait() (time.Duration, bool) { return 0, false }
