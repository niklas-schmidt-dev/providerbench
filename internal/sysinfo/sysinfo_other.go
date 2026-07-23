//go:build !linux && !darwin

package sysinfo

func fill(info *Info) {}
