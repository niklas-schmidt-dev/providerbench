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
	digitaloceancampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/digitalocean"
	hetznercampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/hetzner"
	storagecampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/storage"
)

const campaignUsage = `Usage:
  providerbench campaign hetzner [flags]
  providerbench campaign digitalocean [flags]
  providerbench campaign vercel [flags]
  providerbench campaign storage [flags]

Run ` + "`providerbench campaign <provider> --help`" + ` for provider-specific
measurement, pricing, authentication, and lifecycle options.
`

const storageCampaignUsage = `Usage:
  providerbench campaign storage [flags]

The storage campaign command measures one S3-compatible target endpoint from
fresh Hetzner vantage hosts. It creates the vantage fleet in one spread
placement group, delivers the PB_S3_* credentials over SSH stdin (never via
command lines), runs the s3 suite, downloads dated storage-v1 reports, and
deletes every host. One runner covers every storage provider — R2, S3, B2,
Tigris, MinIO, ... — the target is configuration, not code.

Environment (required):
  HCLOUD_TOKEN        Hetzner API token for the vantage fleet
  PB_S3_ENDPOINT      https://<endpoint> of the target
  PB_S3_BUCKET        bucket created for benchmarking
  PB_S3_ACCESS_KEY    access key id
  PB_S3_SECRET_KEY    secret access key
Optional: PB_S3_REGION, PB_S3_PREFIX, PB_S3_PATH_STYLE (forwarded verbatim).

Required flags (the target's identity in the dataset):
      --campaign ID       benchmark campaign identifier
      --provider NAME     storage company, e.g. cloudflare
      --product NAME      offering, e.g. r2
      --plan NAME         plan or storage class, e.g. standard
      --region NAME       bucket region as sold, e.g. auto or eu-central

Safety:
      --dry-run           validate and print the plan without API calls
      --confirm-cost      required to create billable resources

Target pricing (optional; storage pricing is usage-based):
      --tier NAME         price tier (default usage-based)
      --price-hour EUR    effective hourly price when meaningful
      --price-month EUR   effective monthly price when meaningful

Vantage fleet:
      --vantage-plan NAME   Hetzner server type (default cpx22)
      --vantage-region NAME Hetzner location (default fsn1)
      --count N             independent vantage hosts (default 10; maximum 10)
      --repeats N           measurements per host (default 3)
      --quick               run the shorter suite (never ranked)
      --image NAME          Hetzner image (default ubuntu-24.04)
      --ssh-key-name NAME   SSH key name in the Hetzner project
      --ssh-private-key F   local private key (default ~/.ssh/id_rsa)
      --ssh-timeout D       per-host SSH readiness timeout (default 3m)
      --binary FILE         Linux benchmark binary to upload
                            (default bin/providerbench-linux-amd64)
      --output-dir DIR      downloaded reports (default data/results)
      --pricing-as-of D     price observation date, YYYY-MM-DD (default today)
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
  -t, --tests LIST        comma-separated benchmark tests (default: the
                          whole suite)
      --category NAME     suite to run: compute, workload, platform, reach
                          (default compute). One campaign measures one suite;
                          give each suite its own --campaign ID.
      --profile NAME      standard or sustained (default standard). A
                          sustained run takes 15 minutes per repeat.
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

const digitalOceanCampaignUsage = `Usage:
  providerbench campaign digitalocean [flags]

The DigitalOcean campaign command selects the cheapest currently available
shared-CPU Basic size with exactly 2 vCPUs and 4096 MiB in fra1. It requests
ten tagged Droplets together, takes three measurements on each, and destroys
every Droplet. DIGITALOCEAN_TOKEN is read only from the environment.

Required flags:
      --campaign ID          benchmark campaign identifier
      --ssh-key-fingerprint  SSH key fingerprint registered with DigitalOcean
      --usd-to-eur RATE      conversion rate in EUR per USD

Safety:
      --dry-run              validate and print the plan without API calls
      --confirm-cost         required to create billable resources

Provisioning:
      --ssh-private-key F    local private key (default ~/.ssh/id_rsa)
      --ssh-timeout D        per-host SSH readiness timeout (default 3m)
      --image NAME           DigitalOcean image (default ubuntu-24-04-x64)
      --binary FILE          Linux benchmark binary to upload
                             (default bin/providerbench-linux-amd64)
      --output-dir DIR       downloaded reports (default data/results)
      --pricing-as-of D      FX/price observation date, YYYY-MM-DD
                             (default today UTC)
`

func campaignCmd(args []string) int {
	if len(args) == 0 {
		fmt.Fprint(os.Stderr, campaignUsage)
		return 2
	}
	switch args[0] {
	case "hetzner":
		return hetznerCampaignCmd(args[1:])
	case "digitalocean":
		return digitalOceanCampaignCmd(args[1:])
	case "vercel":
		return vercelCampaignCmd(args[1:])
	case "storage":
		return storageCampaignCmd(args[1:])
	case "help", "-h", "--help":
		fmt.Print(campaignUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown campaign provider %q\n\n%s", args[0], campaignUsage)
		return 2
	}
}

func digitalOceanCampaignCmd(args []string) int {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve home directory:", err)
		return 1
	}

	fs := flag.NewFlagSet("campaign digitalocean", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var cfg digitaloceancampaign.Config
	var dryRun, confirmCost bool
	fs.StringVar(&cfg.Campaign, "campaign", "", "benchmark campaign identifier")
	fs.StringVar(&cfg.SSHKeyFingerprint, "ssh-key-fingerprint", "", "DigitalOcean SSH key fingerprint")
	fs.StringVar(&cfg.SSHPrivateKey, "ssh-private-key", filepath.Join(home, ".ssh", "id_rsa"), "local SSH private key")
	fs.DurationVar(&cfg.SSHTimeout, "ssh-timeout", 3*time.Minute, "SSH readiness timeout")
	fs.StringVar(&cfg.Image, "image", "ubuntu-24-04-x64", "DigitalOcean image")
	fs.StringVar(&cfg.Binary, "binary", filepath.Join("bin", "providerbench-linux-amd64"), "Linux providerbench binary")
	fs.StringVar(&cfg.OutputDir, "output-dir", filepath.Join("data", "results"), "downloaded report directory")
	fs.StringVar(&cfg.PricingAsOf, "pricing-as-of", time.Now().UTC().Format(time.DateOnly), "price and FX observation date")
	fs.Float64Var(&cfg.USDToEUR, "usd-to-eur", 0, "EUR value of one USD")
	fs.BoolVar(&dryRun, "dry-run", false, "print plan without API calls")
	fs.BoolVar(&confirmCost, "confirm-cost", false, "confirm creation of billable resources")
	fs.Usage = func() { fmt.Fprint(fs.Output(), digitalOceanCampaignUsage) }

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
	if err := digitaloceancampaign.Validate(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if dryRun {
		digitaloceancampaign.Describe(os.Stdout, cfg)
		return 0
	}
	if !confirmCost {
		fmt.Fprintln(os.Stderr, "refusing to create billable resources without --confirm-cost (use --dry-run to inspect the plan)")
		return 2
	}
	if err := validateDigitalOceanCampaignFiles(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	token := strings.TrimSpace(os.Getenv("DIGITALOCEAN_TOKEN"))
	if token == "" {
		fmt.Fprintln(os.Stderr, "DIGITALOCEAN_TOKEN is required")
		return 2
	}

	remote, closeRemote, err := digitaloceancampaign.NewOpenSSH(
		cfg.SSHPrivateKey,
		os.Stdout,
		os.Stderr,
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "initialize SSH:", err)
		return 1
	}
	defer closeRemote()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	runner := digitaloceancampaign.Runner{
		Cloud:  digitaloceancampaign.NewCloud(token),
		Remote: remote,
		Out:    os.Stdout,
	}
	if err := runner.Run(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "DigitalOcean campaign failed:", err)
		if ctx.Err() != nil {
			return 130
		}
		return 1
	}
	return 0
}

func validateDigitalOceanCampaignFiles(cfg digitaloceancampaign.Config) error {
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
	fs.StringVar(&cfg.Category, "category", "", "benchmark category (default: inferred from --tests, else compute)")
	fs.StringVar(&cfg.Profile, "profile", "", "measurement profile (default: inferred from --tests, else standard)")
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
	suite, err := bench.ResolveSuite(cfg.Category, cfg.Profile, cfg.Tests, cfg.Quick)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	cfg.Category, cfg.Profile = suite.Category, suite.Profile
	if err := hetznercampaign.Validate(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
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

func storageCampaignCmd(args []string) int {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve home directory:", err)
		return 1
	}

	fs := flag.NewFlagSet("campaign storage", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var cfg storagecampaign.Config
	var dryRun, confirmCost bool
	fs.StringVar(&cfg.Campaign, "campaign", "", "benchmark campaign identifier")
	fs.StringVar(&cfg.Target.Provider, "provider", "", "storage company, e.g. cloudflare")
	fs.StringVar(&cfg.Target.Product, "product", "", "offering, e.g. r2")
	fs.StringVar(&cfg.Target.Plan, "plan", "", "plan or storage class")
	fs.StringVar(&cfg.Target.Tier, "tier", "usage-based", "price tier")
	fs.StringVar(&cfg.Target.Region, "region", "", "bucket region as sold")
	fs.Float64Var(&cfg.Target.PriceHour, "price-hour", 0, "effective hourly price in EUR")
	fs.Float64Var(&cfg.Target.PriceMonth, "price-month", 0, "effective monthly price in EUR")
	fs.StringVar(&cfg.VantagePlan, "vantage-plan", "cpx22", "Hetzner server type for vantage hosts")
	fs.StringVar(&cfg.VantageRegion, "vantage-region", "fsn1", "Hetzner location for vantage hosts")
	fs.IntVar(&cfg.Count, "count", 10, "independent vantage hosts")
	fs.IntVar(&cfg.Repeats, "repeats", 3, "measurements per host")
	fs.BoolVar(&cfg.Quick, "quick", false, "run shorter benchmark workloads")
	fs.StringVar(&cfg.SSHKeyName, "ssh-key-name", "", "Hetzner project SSH key")
	fs.StringVar(&cfg.SSHPrivateKey, "ssh-private-key", filepath.Join(home, ".ssh", "id_rsa"), "local SSH private key")
	fs.DurationVar(&cfg.SSHTimeout, "ssh-timeout", 3*time.Minute, "SSH readiness timeout")
	fs.StringVar(&cfg.Image, "image", "ubuntu-24.04", "Hetzner image")
	fs.StringVar(&cfg.Binary, "binary", filepath.Join("bin", "providerbench-linux-amd64"), "Linux providerbench binary")
	fs.StringVar(&cfg.OutputDir, "output-dir", filepath.Join("data", "results"), "downloaded report directory")
	fs.StringVar(&cfg.PricingAsOf, "pricing-as-of", time.Now().UTC().Format(time.DateOnly), "price observation date")
	fs.BoolVar(&dryRun, "dry-run", false, "print plan without API calls")
	fs.BoolVar(&confirmCost, "confirm-cost", false, "confirm creation of billable resources")
	fs.Usage = func() { fmt.Fprint(fs.Output(), storageCampaignUsage) }

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

	// Target credentials come from the environment only.
	cfg.Target.Endpoint = strings.TrimSpace(os.Getenv("PB_S3_ENDPOINT"))
	cfg.Target.Bucket = strings.TrimSpace(os.Getenv("PB_S3_BUCKET"))
	cfg.Target.AccessKey = strings.TrimSpace(os.Getenv("PB_S3_ACCESS_KEY"))
	cfg.Target.SecretKey = strings.TrimSpace(os.Getenv("PB_S3_SECRET_KEY"))
	cfg.Target.S3Region = strings.TrimSpace(os.Getenv("PB_S3_REGION"))
	cfg.Target.S3Prefix = strings.TrimSpace(os.Getenv("PB_S3_PREFIX"))
	cfg.Target.PathStyle = strings.TrimSpace(os.Getenv("PB_S3_PATH_STYLE"))

	if err := storagecampaign.Validate(cfg); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if dryRun {
		storagecampaign.Describe(os.Stdout, cfg)
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
	if key, err := os.Stat(cfg.SSHPrivateKey); err != nil {
		fmt.Fprintln(os.Stderr, "SSH private key:", err)
		return 2
	} else if !key.Mode().IsRegular() {
		fmt.Fprintln(os.Stderr, "SSH private key is not a regular file:", cfg.SSHPrivateKey)
		return 2
	}
	token := strings.TrimSpace(os.Getenv("HCLOUD_TOKEN"))
	if token == "" {
		fmt.Fprintln(os.Stderr, "HCLOUD_TOKEN is required for the Hetzner vantage fleet")
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
	runner := storagecampaign.Runner{
		Cloud:  hetznercampaign.NewCloud(token, version),
		Remote: remote,
		Out:    os.Stdout,
	}
	if err := runner.Run(ctx, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "storage campaign failed:", err)
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
