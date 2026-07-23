// Package sysinfo collects host metadata for benchmark reports.
package sysinfo

import (
	"runtime"
)

// Info describes the machine a benchmark ran on. Hostname is deliberately
// not collected: reports are meant to be shared publicly.
type Info struct {
	OS             string `json:"os"`
	Arch           string `json:"arch"`
	Kernel         string `json:"kernel,omitempty"`
	CPUModel       string `json:"cpu_model,omitempty"`
	CPUCores       int    `json:"cpu_cores"`
	MemTotalMB     int64  `json:"mem_total_mb,omitempty"`
	Virtualization string `json:"virtualization,omitempty"`
}

func Collect() Info {
	info := Info{
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		CPUCores: runtime.NumCPU(),
	}
	fill(&info) // platform-specific fields
	return info
}
