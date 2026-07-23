//go:build !linux

package compute

type cpuTicks struct {
	total uint64
	steal uint64
}

// readCPUSteal is only implemented on Linux; other platforms don't expose
// hypervisor steal time.
func readCPUSteal() (cpuTicks, bool) {
	return cpuTicks{}, false
}
