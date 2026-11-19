//go:build linux

package platform

import "syscall"

const madvNoHugePage = 15 // MADV_NOHUGEPAGE, identical on every Linux architecture

// declineHugePages keeps the mapping on base pages. With transparent huge
// pages one fault would cover 2 MiB and the result would depend on the
// distribution's THP default instead of the fault path.
func declineHugePages(mem []byte) {
	syscall.Madvise(mem, madvNoHugePage)
}
