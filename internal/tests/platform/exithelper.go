package platform

import (
	"encoding/binary"
	"fmt"
)

// exitHelper returns a complete static Linux executable for arch that does
// one thing: exit(0). It is one ELF header, one program header and three
// instructions — small enough to read in full, and identical on every
// machine of an architecture.
func exitHelper(arch string) ([]byte, error) {
	const (
		headerSize  = 64
		programSize = 56
		loadAddress = 0x400000
		codeOffset  = headerSize + programSize
	)
	var machine uint16
	var code []byte
	switch arch {
	case "amd64":
		machine = 0x3e // EM_X86_64
		code = []byte{
			0xb8, 0x3c, 0x00, 0x00, 0x00, // mov eax, 60 (exit)
			0x31, 0xff, // xor edi, edi
			0x0f, 0x05, // syscall
		}
	case "arm64":
		machine = 0xb7                                            // EM_AARCH64
		code = binary.LittleEndian.AppendUint32(nil, 0xd2800000)  // mov x0, #0
		code = binary.LittleEndian.AppendUint32(code, 0xd2800ba8) // mov x8, #93 (exit)
		code = binary.LittleEndian.AppendUint32(code, 0xd4000001) // svc #0
	default:
		return nil, fmt.Errorf("no exit helper for architecture %q", arch)
	}
	size := uint64(codeOffset + len(code))
	le := binary.LittleEndian

	out := make([]byte, 0, size)
	// ELF header.
	out = append(out, 0x7f, 'E', 'L', 'F', 2 /* 64-bit */, 1 /* little endian */, 1 /* version */, 0 /* System V */)
	out = append(out, make([]byte, 8)...)
	out = le.AppendUint16(out, 2) // ET_EXEC
	out = le.AppendUint16(out, machine)
	out = le.AppendUint32(out, 1)                      // EV_CURRENT
	out = le.AppendUint64(out, loadAddress+codeOffset) // entry point
	out = le.AppendUint64(out, headerSize)             // program header offset
	out = le.AppendUint64(out, 0)                      // no section headers
	out = le.AppendUint32(out, 0)                      // flags
	out = le.AppendUint16(out, headerSize)
	out = le.AppendUint16(out, programSize)
	out = le.AppendUint16(out, 1)  // one program header
	out = le.AppendUint16(out, 64) // section header entry size
	out = le.AppendUint16(out, 0)  // no section headers
	out = le.AppendUint16(out, 0)
	// Program header: map the whole file read+execute.
	out = le.AppendUint32(out, 1) // PT_LOAD
	out = le.AppendUint32(out, 5) // PF_R | PF_X
	out = le.AppendUint64(out, 0) // file offset
	out = le.AppendUint64(out, loadAddress)
	out = le.AppendUint64(out, loadAddress)
	out = le.AppendUint64(out, size)
	out = le.AppendUint64(out, size)
	out = le.AppendUint64(out, 0x10000) // alignment that also suits 64 KiB pages
	return append(out, code...), nil
}
