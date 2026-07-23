//go:build linux

package compute

import (
	"os"
	"syscall"
	"unsafe"
)

// openDirect opens path for reading with O_DIRECT so reads hit the device
// instead of the page cache. Falls back to a normal open if O_DIRECT is not
// supported by the filesystem (e.g. tmpfs).
func openDirect(path string) (*os.File, bool, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECT, 0)
	if err == nil {
		return f, true, nil
	}
	f, err = os.Open(path)
	return f, false, err
}

// alignedBuf returns a size-byte slice whose base address is align-aligned,
// as required for O_DIRECT reads.
func alignedBuf(size, align int) []byte {
	raw := make([]byte, size+align)
	off := int(uintptr(unsafe.Pointer(&raw[0])) & uintptr(align-1))
	if off != 0 {
		off = align - off
	}
	return raw[off : off+size]
}
