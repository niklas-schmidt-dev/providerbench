//go:build !linux

package kit

// ReadCPUTicks is only implemented on Linux; other platforms don't expose
// hypervisor steal time.
func ReadCPUTicks() (CPUTicks, bool) { return CPUTicks{}, false }

// Clocksource is only known on Linux.
func Clocksource() string { return "" }
