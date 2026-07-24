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
	hetznercampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/hetzner"
)

const campaignUsage = `Usage:
  providerbench campaign hetzner [flags]
  providerbench campaign vercel [flags]

Run ` + "`providerbench campaign <provider> --help`" + ` for provider-specific
measurement, pricing, authentication, and lifecycle options.
`

const hetznerCampaignUsage = `Usage:
  providerbench campaign hetzner [flags]

The Hetzner campaign command creates all fresh hosts in one spread placement
group, benchmarks them sequentially, downloads dated JSON reports, and deletes
each server plus the placement group. HCLOUD_TOKEN is read only from the
environment.

Required flags:
      --campaign ID       benchmark campaign identifier
      --plan NAME         Hetzner server type, e.g. cpx22 or ccx13
      --tier NAME         price tier: cheap, medium, dedicated
      --region NAME       Hetzner location, e.g. fsn1 or hel1
      --ssh-key-name NAME SSH key name in the Hetzner project
      --price-hour EUR    net hourly price, excluding VAT
      --price-month EUR   net monthly price, excluding VAT

Safety:
      --dry-run           validate and print the plan without API calls
      --confirm-cost      required to create billable resources

Measurement:
      --count N           independent fresh hosts (default 10; maximum 10)
      --repeats N         measurements per host (default 3)
  -t, --tests LIST        comma-separated benchmark tests (default all)
      --quick             run shorter benchmark workloads
      --output-dir DIR    downloaded reports (default data/results)

Provisioning:
      --ssh-private-key F local private key (default ~/.ssh/id_rsa)
      --ssh-timeout D     per-host SSH readiness timeout (default 3m)
      --image NAME        Hetzner image (default ubuntu-24.04)
      --binary FILE       Linux benchmark binary to upload
                          (default bin/providerbench-linux-amd64)
      --pricing-as-of D   price observation date, YYYY-MM-DD (default today UTC)
      --pricing-basis S   reproducibility note stored in every report
`

func campaignCmd(args []string) int {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, campaignUsage)
		return 2
	}
	switch args[0] {
	case "hetzner":
		return hetznerCampaignCmd(args[1:])
	case "vercel":
		return vercelCampaignCmd(args[1:])
	case "help", "-h", "--help":
		fmt.Print(campaignUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown campaign provider %q\n\n%s", args[0], campaignUsage)
		return 2
	}
}

func hetznerCampaignCmd(args []string) int {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve home directory:", err)
		return 1
	}

	fs := flag.NewFlagSet("campaign hetzner", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var cfg hetznercampaign.Config
	var dryRun, confirmCost bool
	fs.StringVar(&cfg.Campaign, "campaign", "", "benchmark campaign identifier")
	fs.StringVar(&cfg.Plan, "plan", "", "Hetzner server type")
	fs.StringVar(&cfg.Tier, "tier", "", "price tier")
	fs.StringVar(&cfg.Region, "region", "", "Hetzner location")
	fs.IntVar(&cfg.Count, "count", 10, "independent fresh hosts")
	fs.IntVar(&cfg.Repeats, "repeats", 3, "measurements per host")
	fs.Float64Var(&cfg.PriceHour, "price-hour", 0, "hourly price in EUR")
	fs.Float64Var(&cfg.PriceMonth, "price-month", 0, "monthly price in EUR")
	fs.StringVar(&cfg.SSHKeyName, "ssh-key-name", "", "Hetzner project SSH key")
	fs.StringVar(&cfg.SSHPrivateKey, "ssh-private-key", filepath.Join(home, ".ssh", "id_rsa"), "local SSH private key")
	fs.DurationVar(&cfg.SSHTimeout, "ssh-timeout", 3*time.Minute, "SSH readiness timeout")
	fs.StringVar(&cfg.Image, "image", "ubuntu-24.04", "Hetzner image")
	fs.StringVar(&cfg.Binary, "binary", filepath.Join("bin", "providerbench-linux-amd64"), "Linux providerbench binary")
	fs.StringVar(&cfg.OutputDir, "output-dir", filepath.Join("data", "results"), "downloaded report directory")
	fs.StringVar(&cfg.Tests, "tests", "", "comma-separated benchmark tests")
	fs.StringVar(&cfg.Tests, "t", "", "alias for --tests")
	fs.BoolVar(&cfg.Quick, "quick", false, "run shorter benchmark workloads")
	fs.StringVar(&cfg.PricingAsOf, "pricing-as-of", time.Now().UTC().Format(time.DateOnly), "price observation date")
	fs.StringVar(&cfg.PricingBasis, "pricing-basis", "server+primary-ipv4-net-excl-vat", "pricing note stored in reports")
	fs.BoolVar(&dryRun, "dry-run", false, "print plan without API calls")
	fs.BoolVar(&confirmCost, "confirm-cost", false, "confirm creation of billable resources")
	fs.Usage = func() { fmt.Fprint(fs.Output(), hetznerCampaignUsage) }

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
	if err := hetznercampaign.Validate(cfg); err != nil {
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
		hetznercampaign.Describe(os.Stdout, cfg)
		return 0
	}
	if !confirmCost {
		fmt.Fprintln(os.Stderr, "refusing to create billable resources without --confirm-cost (use --dry-run to inspect the plan)")
		return 2
	}
	if err := validateCampaignFiles(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	token := strings.TrimSpace(os.Getenv("HCLOUD_TOKEN"))
	if token == "" {
		fmt.Fprintln(os.Stderr, "HCLOUD_TOKEN is required")
		return 2
	}

	remote, closeRemote, err := hetznercampaign.NewOpenSSH(cfg.SSHPrivateKey, os.Stdout, os.Stderr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "initialize SSH:", err)
		return 1
	}
	defer closeRemote()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	runner := hetznercampaign.Runner{
		Cloud:  hetznercampaign.NewCloud(token, version),
		Remote: remote,
		Out:    os.Stdout,
	}
	if err := runner.Run(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "Hetzner campaign failed:", err)
		if ctx.Err() != nil {
			return 130
		}
		return 1
	}
	return 0
}

func validateCampaignFiles(cfg hetznercampaign.Config) error {
	if err := validateExecutable(cfg.Binary); err != nil {
		return err
	}
	key, err := os.Stat(cfg.SSHPrivateKey)
	if err != nil {
		return fmt.Errorf("SSH private key: %w", err)
	}
	if !key.Mode().IsRegular() {
		return fmt.Errorf("SSH private key is not a regular file: %s", cfg.SSHPrivateKey)
	}
	return nil
}
