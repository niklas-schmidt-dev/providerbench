package vercel

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// CLI implements Client through Vercel's supported `vercel sandbox` command.
// Authentication remains in Vercel's credential store or VERCEL_AUTH_TOKEN;
// ProviderBench never accepts a token flag.
type CLI struct {
	binary  string
	project string
	scope   string
	stdout  io.Writer
	stderr  io.Writer
}

func NewCLI(project, scope string, stdout, stderr io.Writer) (*CLI, error) {
	binary, err := exec.LookPath("vercel")
	if err != nil {
		return nil, errors.New("Vercel CLI not found; install v54.15.1 or newer")
	}
	if stdout == nil {
		stdout = io.Discard
	}
	if stderr == nil {
		stderr = io.Discard
	}
	return &CLI{
		binary:  binary,
		project: project,
		scope:   scope,
		stdout:  stdout,
		stderr:  stderr,
	}, nil
}

func (c *CLI) Preflight(ctx context.Context) error {
	args := c.withScope([]string{"sandbox", "list", "--all", "--limit", "1"})
	command := exec.CommandContext(ctx, c.binary, args...)
	var stderr bytes.Buffer
	command.Stdout = io.Discard
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return commandError(err, stderr.Bytes())
	}
	return nil
}

func (c *CLI) Version(ctx context.Context) (string, error) {
	command := exec.CommandContext(ctx, c.binary, "--version")
	var stdout bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = io.Discard
	if err := command.Run(); err != nil {
		return "", err
	}
	version := strings.TrimSpace(stdout.String())
	if version == "" {
		return "", errors.New("Vercel CLI returned an empty version")
	}
	return version, nil
}

func (c *CLI) Create(ctx context.Context, opts CreateOptions) error {
	args := []string{
		"sandbox", "create",
		"--name", opts.Name,
		"--runtime", opts.Runtime,
		"--vcpus", fmt.Sprintf("%d", opts.VCPUs),
		"--timeout", cliDuration(opts.Timeout),
		"--non-persistent",
		"--silent",
	}
	keys := make([]string, 0, len(opts.Tags))
	for key := range opts.Tags {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		args = append(args, "--tag", key+"="+opts.Tags[key])
	}
	return c.run(ctx, c.withScope(args), io.Discard, c.stderr)
}

func (c *CLI) CopyTo(ctx context.Context, name, local, remote string) error {
	args := c.withScope([]string{"sandbox", "copy", local, name + ":" + remote})
	return c.run(ctx, args, io.Discard, c.stderr)
}

func (c *CLI) Exec(
	ctx context.Context,
	name string,
	timeout time.Duration,
	binary string,
	commandArgs []string,
) error {
	args := []string{
		"sandbox", "exec",
		"--timeout", cliDuration(timeout),
		"--workdir", "/vercel/sandbox",
	}
	args = c.withScope(args)
	args = append(args, name, "--", binary)
	args = append(args, commandArgs...)
	return c.run(ctx, args, c.stdout, c.stderr)
}

func (c *CLI) CopyFrom(ctx context.Context, name, remote, local string) error {
	args := c.withScope([]string{"sandbox", "copy", name + ":" + remote, local})
	return c.run(ctx, args, io.Discard, c.stderr)
}

func (c *CLI) Remove(ctx context.Context, name string) error {
	args := c.withScope([]string{"sandbox", "remove", name})
	command := exec.CommandContext(ctx, c.binary, args...)
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		detail := strings.ToLower(output.String())
		if strings.Contains(detail, "not found") || strings.Contains(detail, "does not exist") {
			return nil
		}
		return commandError(err, output.Bytes())
	}
	return nil
}

func (c *CLI) withScope(args []string) []string {
	scoped := append([]string(nil), args...)
	if c.project != "" {
		scoped = append(scoped, "--project", c.project)
	}
	if c.scope != "" {
		scoped = append(scoped, "--scope", c.scope)
	}
	return scoped
}

func (c *CLI) run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	command := exec.CommandContext(ctx, c.binary, args...)
	command.Stdout = stdout
	command.Stderr = stderr
	return command.Run()
}

func cliDuration(duration time.Duration) string {
	if duration%time.Hour == 0 {
		return fmt.Sprintf("%dh", int(duration/time.Hour))
	}
	if duration%time.Minute == 0 {
		return fmt.Sprintf("%dm", int(duration/time.Minute))
	}
	return duration.Round(time.Second).String()
}

func commandError(err error, output []byte) error {
	detail := strings.TrimSpace(string(output))
	if detail == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, detail)
}
