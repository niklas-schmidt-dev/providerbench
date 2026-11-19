//go:build !linux && !darwin

package compute

import "os"

// openDirect has no page-cache bypass on this platform; reads may be cached.
func openDirect(path string) (*os.File, bool, error) {
	f, err := os.Open(path)
	return f, false, err
}

// openDirectWrite has no page-cache bypass on this platform either.
func openDirectWrite(path string) (*os.File, bool, error) {
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	return f, false, err
}

func alignedBuf(size, _ int) []byte {
	return make([]byte, size)
}
