package kit

// CPUTicks is a snapshot of the kernel's aggregate CPU accounting.
type CPUTicks struct {
	Total uint64
	Steal uint64
}

// StealPercent returns the share of CPU time the hypervisor reported as
// stolen between two snapshots.
func StealPercent(before, after CPUTicks) float64 {
	total := after.Total - before.Total
	if after.Total <= before.Total || after.Steal < before.Steal {
		return 0
	}
	return float64(after.Steal-before.Steal) / float64(total) * 100
}
