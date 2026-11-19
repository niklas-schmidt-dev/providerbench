//go:build darwin

package platform

// declineHugePages is a no-op: macOS does not promote anonymous mappings to
// superpages on its own.
func declineHugePages([]byte) {}
