//go:build darwin

package sysinfo

import (
	"os/exec"
	"strconv"
	"strings"
)

func fill(info *Info) {
	info.Kernel = sysctl("kern.osrelease")
	info.CPUModel = sysctl("machdep.cpu.brand_string")
	if bytes, err := strconv.ParseInt(sysctl("hw.memsize"), 10, 64); err == nil {
		info.MemTotalMB = bytes / (1024 * 1024)
	}
}

func sysctl(key string) string {
	out, err := exec.Command("sysctl", "-n", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
