//go:build !darwin

package compute

import "os"

// disableWriteCache is only needed on darwin; on Linux the read phase uses
// O_DIRECT, which bypasses the page cache regardless of how the file was
// written.
func disableWriteCache(*os.File) {}
