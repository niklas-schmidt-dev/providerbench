//go:build linux

package kit

import (
	"os"
	"strconv"
	"strings"
)

// ReadCPUTicks parses the aggregate "cpu" line of /proc/stat.
// Fields: user nice system idle iowait irq softirq steal guest guest_nice.
// The two guest fields are already counted in user and nice.
func ReadCPUTicks() (CPUTicks, bool) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return CPUTicks{}, false
	}
	for line := range strings.Lines(string(data)) {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:]
		if len(fields) < 8 {
			return CPUTicks{}, false
		}
		var t CPUTicks
		for i, f := range fields[:8] {
			v, err := strconv.ParseUint(f, 10, 64)
			if err != nil {
				return CPUTicks{}, false
			}
			t.Total += v
			if i == 7 {
				t.Steal = v
			}
		}
		return t, true
	}
	return CPUTicks{}, false
}

// Clocksource returns the kernel's active clocksource, e.g. "tsc" or
// "kvm-clock", or "" when it cannot be read.
func Clocksource() string {
	data, err := os.ReadFile("/sys/devices/system/clocksource/clocksource0/current_clocksource")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
