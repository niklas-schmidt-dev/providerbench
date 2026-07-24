package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	vercelcampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/vercel"
)

const vercelCampaignUsage = `Usage:
  providerbench campaign vercel [flags]

The Vercel command creates one fresh Sandbox per sample, runs multiple
measurements on it, validates and downloads every dated report, then permanently
removes the Sandbox. It uses the supported Vercel CLI for authentication and
transport; provisioning and lifecycle decisions live in ProviderBench's Go CLI.

Required flags:
      --campaign ID       benchmark campaign identifier
      --price-hour EUR    continuous full-utilization equivalent in EUR/hour
      --price-month EUR   continuous full-utilization equivalent in EUR/month

Safety:
      --dry-run           validate and print the plan without Vercel requests
      --confirm-cost      required to create billable resources

Measurement:
      --count N           fresh Sandbox samples (default 10)
      --repeats N         measurements per Sandbox (default 3)
      --vcpus N           Sandbox vCPUs; RAM is 2 GB/vCPU (default 2)
  -t, --tests LIST        comma-separated benchmark tests (default all)
      --quick             run shorter benchmark workloads
      --output-dir DIR    downloaded reports (default data/results)

Provisioning:
      --runtime NAME      Sandbox runtime (default node24)
      --sandbox-timeout D maximum Sandbox session duration (default 10m)
      --command-timeout D timeout for each benchmark repeat (default 4m)
      --binary FILE       Linux AMD64 ProviderBench binary to upload
      --project NAME      Vercel project name/ID (otherwise infer linked project)
      --scope NAME        Vercel team/scope (otherwise infer linked project)
      --pricing-as-of D   price observation date, YYYY-MM-DD (default today UTC)
      --pricing-basis S   pricing formula stored in every report

Authentication:
  Run ` + "`vercel sandbox login`" + ` or provide VERCEL_AUTH_TOKEN through
  Vercel's supported credential flow. ProviderBench does not accept token flags.
`

func vercelCampaignCmd(args []string) int {
	fs := flag.NewFlagSet("campaign vercel", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var cfg vercelcampaign.Config
	var project, scope string
	var dryRun, confirmCost bool
	fs.StringVar(&cfg.Campaign, "campaign", "", "benchmark campaign identifier")
	fs.IntVar(&cfg.Count, "count", 10, "fresh Sandbox samples")
	fs.IntVar(&cfg.Repeats, "repeats", 3, "measurements per Sandbox")
	fs.IntVar(&cfg.VCPUs, "vcpus", 2, "Sandbox vCPUs")
	fs.StringVar(&cfg.Runtime, "runtime", "node24", "Sandbox runtime")
	fs.Float64Var(&cfg.PriceHour, "price-hour", 0, "continuous equivalent EUR/hour")
	fs.Float64Var(&cfg.PriceMonth, "price-month", 0, "continuous equivalent EUR/month")
	fs.StringVar(&cfg.Binary, "binary", filepath.Join("bin", "providerbench-linux-amd64"), "Linux AMD64 ProviderBench binary")
	fs.StringVar(&cfg.OutputDir, "output-dir", filepath.Join("data", "results"), "downloaded report directory")
	fs.StringVar(&cfg.Tests, "tests", "", "comma-separated benchmark tests")
	fs.StringVar(&cfg.Tests, "t", "", "alias for --tests")
	fs.BoolVar(&cfg.Quick, "quick", false, "run shorter benchmark workloads")
	fs.StringVar(&cfg.PricingAsOf, "pricing-as-of", time.Now().UTC().Format(time.DateOnly), "price observation date")
	fs.StringVar(
		&cfg.PricingBasis,
		"pricing-basis",
		"continuous-equivalent active CPU + provisioned memory; excludes included quota, creation, and network",
		"pricing formula stored in reports",
	)
	fs.DurationVar(&cfg.SandboxTimeout, "sandbox-timeout", 10*time.Minute, "maximum Sandbox session duration")
	fs.DurationVar(&cfg.CommandTimeout, "command-timeout", 4*time.Minute, "timeout for each benchmark repeat")
	fs.StringVar(&project, "project", "", "Vercel project name or ID")
	fs.StringVar(&scope, "scope", "", "Vercel team or scope")
	fs.BoolVar(&dryRun, "dry-run", false, "print plan without Vercel requests")
	fs.BoolVar(&confirmCost, "confirm-cost", false, "confirm creation of billable resources")
	fs.Usage = func() { fmt.Fprint(fs.Output(), vercelCampaignUsage) }

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if fs.NArg() != 0 {
		fmt.Fprintf(os.Stderr, "unexpected positional arguments: %s\n", strings.Join(fs.Args(), " "))
		return 2
	}
	if err := vercelcampaign.Validate(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if cfg.Tests != "" {
		if _, err := bench.Select(strings.Split(cfg.Tests, ",")); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}
	if dryRun {
		vercelcampaign.Describe(os.Stdout, cfg, project, scope)
		return 0
	}
	if !confirmCost {
		fmt.Fprintln(os.Stderr, "refusing to create billable resources without --confirm-cost (use --dry-run to inspect the plan)")
		return 2
	}
	if err := validateExecutable(cfg.Binary); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	client, err := vercelcampaign.NewCLI(project, scope, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "initialize Vercel transport:", err)
		return 1
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	runner := vercelcampaign.Runner{
		Client: client,
		Out:    os.Stdout,
	}
	if err := runner.Run(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "Vercel campaign failed:", err)
		if ctx.Err() != nil {
			return 130
		}
		return 1
	}
	return 0
}

func validateExecutable(path string) error {
	file, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("benchmark binary: %w", err)
	}
	if file.IsDir() || file.Mode()&0o111 == 0 {
		return fmt.Errorf("benchmark binary is not executable: %s", path)
	}
	return nil
}
