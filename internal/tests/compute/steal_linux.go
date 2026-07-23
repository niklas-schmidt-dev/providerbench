//go:build linux

package compute

import (
	"os"
	"strconv"
	"strings"
)

type cpuTicks struct {
	total uint64
	steal uint64
}

// readCPUSteal parses the aggregate "cpu" line of /proc/stat.
// Fields: user nice system idle iowait irq softirq steal guest guest_nice
func readCPUSteal() (cpuTicks, bool) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTicks{}, false
	}
	for line := range strings.Lines(string(data)) {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		if len(fields) < 8 {
			return cpuTicks{}, false
		}
		var t cpuTicks
		for i, f := range fields {
			v, err := strconv.ParseUint(f, 10, 64)
			if err != nil {
				return cpuTicks{}, false
			}
			t.total += v
			if i == 7 {
				t.steal = v
			}
		}
		return t, true
	}
	return cpuTicks{}, false
}
