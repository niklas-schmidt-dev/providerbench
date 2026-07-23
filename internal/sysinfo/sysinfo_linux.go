//go:build linux

package sysinfo

import (
	"bufio"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func fill(info *Info) {
	info.Kernel = kernelVersion()
	info.CPUModel = cpuModel()
	info.MemTotalMB = memTotalMB()
	info.Virtualization = virtualization()
}

func kernelVersion() string {
	var uts syscall.Utsname
	if err := syscall.Uname(&uts); err != nil {
		return ""
	}
	return charsToString(uts.Release[:])
}

func charsToString(cs []int8) string {
	b := make([]byte, 0, len(cs))
	for _, c := range cs {
		if c == 0 {
			break
		}
		b = append(b, byte(c))
	}
	return string(b)
}

func cpuModel() string {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		// x86 uses "model name", some ARM kernels use "Hardware" or "Model"
		for _, key := range []string{"model name", "Hardware", "Model"} {
			if strings.HasPrefix(line, key) {
				if _, val, ok := strings.Cut(line, ":"); ok {
					return strings.TrimSpace(val)
				}
			}
		}
	}
	return ""
}

func memTotalMB() int64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if kb, ok := strings.CutPrefix(sc.Text(), "MemTotal:"); ok {
			fields := strings.Fields(kb)
			if len(fields) >= 1 {
				if n, err := strconv.ParseInt(fields[0], 10, 64); err == nil {
					return n / 1024
				}
			}
		}
	}
	return 0
}

func virtualization() string {
	// systemd-detect-virt gives the most precise answer when available.
	if out, err := exec.Command("systemd-detect-virt").Output(); err == nil {
		if v := strings.TrimSpace(string(out)); v != "" && v != "none" {
			return v
		}
	}
	// Fall back to DMI vendor strings (KVM, QEMU, Xen, VMware, Amazon EC2, ...).
	for _, p := range []string{"/sys/class/dmi/id/product_name", "/sys/class/dmi/id/sys_vendor"} {
		if b, err := os.ReadFile(p); err == nil {
			if v := strings.TrimSpace(string(b)); v != "" {
				return v
			}
		}
	}
	return ""
}
