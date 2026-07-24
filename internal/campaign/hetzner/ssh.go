package hetzner

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// OpenSSH uses the local OpenSSH client for transport. Cloud provisioning is
// native Go; keeping transport on OpenSSH preserves support for users' existing
// private-key formats and agents without putting secrets in process arguments.
type OpenSSH struct {
	privateKey string
	knownHosts string
	stdout     io.Writer
	stderr     io.Writer
}

// NewOpenSSH creates an isolated known_hosts file for the campaign. The caller
// must call the returned cleanup function.
func NewOpenSSH(privateKey string, stdout, stderr io.Writer) (*OpenSSH, func(), error) {
	if _, err := exec.LookPath("ssh"); err != nil {
		return nil, nil, errors.New("ssh executable not found")
	}
	if _, err := exec.LookPath("scp"); err != nil {
		return nil, nil, errors.New("scp executable not found")
	}
	file, err := os.CreateTemp("", "providerbench-known-hosts-*")
	if err != nil {
		return nil, nil, fmt.Errorf("create temporary known_hosts: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		os.Remove(path)
		return nil, nil, fmt.Errorf("close temporary known_hosts: %w", err)
	}
	if stdout == nil {
		stdout = io.Discard
	}
	if stderr == nil {
		stderr = io.Discard
	}
	client := &OpenSSH{
		privateKey: privateKey,
		knownHosts: path,
		stdout:     stdout,
		stderr:     stderr,
	}
	return client, func() { _ = os.Remove(path) }, nil
}

func (s *OpenSSH) WaitReady(ctx context.Context, server Server, timeout time.Duration) error {
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	var lastErr error
	for {
		command := exec.CommandContext(waitCtx, "ssh", append(s.options(5*time.Second), target(server), "true")...)
		command.Stdout = io.Discard
		command.Stderr = io.Discard
		if err := command.Run(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		select {
		case <-waitCtx.Done():
			return fmt.Errorf("%w (last ssh error: %v)", waitCtx.Err(), lastErr)
		case <-time.After(5 * time.Second):
		}
	}
}

func (s *OpenSSH) CopyBinary(ctx context.Context, server Server, local, remote string) error {
	args := append(s.options(10*time.Second), local, target(server)+":"+remote)
	command := exec.CommandContext(ctx, "scp", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return commandError(err, output)
	}
	return nil
}

func (s *OpenSSH) Run(ctx context.Context, server Server, binary string, args []string) error {
	remoteCommand := make([]string, 0, len(args)+1)
	remoteCommand = append(remoteCommand, shellQuote(binary))
	for _, arg := range args {
		remoteCommand = append(remoteCommand, shellQuote(arg))
	}
	sshArgs := append(s.options(10*time.Second), target(server), strings.Join(remoteCommand, " "))
	command := exec.CommandContext(ctx, "ssh", sshArgs...)
	command.Stdout = s.stdout
	command.Stderr = s.stderr
	if err := command.Run(); err != nil {
		return err
	}
	return nil
}

func (s *OpenSSH) CopyReport(ctx context.Context, server Server, remote, local string) error {
	args := append(s.options(10*time.Second), target(server)+":"+remote, local)
	command := exec.CommandContext(ctx, "scp", args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return commandError(err, output)
	}
	return nil
}

func (s *OpenSSH) options(connectTimeout time.Duration) []string {
	seconds := max(1, int(connectTimeout.Seconds()))
	return []string{
		"-i", s.privateKey,
		"-o", "BatchMode=yes",
		"-o", fmt.Sprintf("ConnectTimeout=%d", seconds),
		"-o", "StrictHostKeyChecking=accept-new",
		"-o", "UserKnownHostsFile=" + s.knownHosts,
	}
}

func target(server Server) string {
	return "root@" + server.IPv4
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func commandError(err error, output []byte) error {
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, detail)
}
