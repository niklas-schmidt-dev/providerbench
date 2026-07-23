//go:build !linux && !darwin

package compute

import "os"

// openDirect has no page-cache bypass on this platform; reads may be cached.
func openDirect(path string) (*os.File, bool, error) {
	f, err := os.Open(path)
	return f, false, err
}

func alignedBuf(size, _ int) []byte {
	return make([]byte, size)
}
