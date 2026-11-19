// providerbench is an open, extendable benchmark for VPS and server
// providers. Run it on any machine, share the JSON, compare on
// providerbench.dev.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/output"
	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/compute"  // registers built-in tests
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/platform" // registers platform-overhead tests
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/reach"    // registers network-reach tests
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/storage"  // registers object-storage tests
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/workload" // registers application workloads
)

// version is overridden at release time via -ldflags "-X main.version=...".
var version string

const usage = `providerbench — open benchmark for VPS & server providers

Usage:
  providerbench run [flags]   run benchmarks
  providerbench campaign hetzner [flags]
                              create, benchmark, and remove a Hetzner cohort
  providerbench campaign digitalocean [flags]
                              create, benchmark, and remove a DigitalOcean cohort
  providerbench campaign vercel [flags]
                              benchmark fresh Vercel Sandbox samples
  providerbench campaign storage [flags]
                              measure an S3-compatible endpoint from fresh
                              Hetzner vantage hosts (storage-v1 cohorts)
  providerbench compare [flags] FILE|DIR ...
                              compare two selections of reports metric by
                              metric, with a bootstrap confidence interval
  providerbench list          list available tests
  providerbench system        show detected system info
  providerbench validate [--dataset] [--manifest FILE] FILE|DIR ...
                              check reports against the schema; directories
                              are checked as data/results submissions
  providerbench version       print version

Run flags:
  -t, --tests cpu,disk    comma-separated tests to run (default: all tests of
                          the category)
      --category NAME     benchmark category: compute, workload, platform,
                          reach, storage (default: inferred from --tests,
                          else compute). A report holds exactly one category.
      --quick             faster, less precise runs
      --profile NAME      measurement profile: standard, sustained (default:
                          inferred from --tests, else standard). A report
                          holds exactly one profile.
      --duration TIME     run each sustained test for TIME instead of its
                          protocol duration, e.g. 2m. The report is marked
                          as a pilot and never enters an aggregate.
      --json FILE         where to write the JSON report; "-" prints it to
                          stdout with no table (default: providerbench-<provider>-<time>.json)
      --dir DIR           scratch directory for the disk, files and spawn
                          tests (default: current dir)
      --provider NAME     provider company, e.g. hetzner, vercel, aws
      --product NAME      the offering tested, e.g. cloud-vps, sandbox, ec2
      --plan NAME         plan/instance type, e.g. cax21
      --tier NAME         price tier: cheap, medium, dedicated, usage-based
      --region NAME       region, e.g. fsn1
      --price EUR         monthly price in EUR (deprecated alias)
      --price-month EUR   monthly price in EUR
      --price-hour EUR    hourly price in EUR
      --campaign ID       benchmark campaign identifier
      --sample-index N    independent host number inside the campaign
      --repeat-index N    repeat number on that host
      --fresh-instance    this sample ran on a newly created instance
      --env KEY=VALUE     reproducibility detail, repeatable,
                          e.g. --env os_image=ubuntu-24.04 --env postgres=16.3

Storage runs (S3-compatible endpoints) read their target from the
environment — credentials never enter flags, reports or shell history:
  PB_S3_ENDPOINT      https://<endpoint>  (required)
  PB_S3_BUCKET        bucket name         (required)
  PB_S3_ACCESS_KEY    access key id       (required)
  PB_S3_SECRET_KEY    secret access key   (required)
  PB_S3_REGION        signing region      (default: us-east-1; R2 uses auto)
  PB_S3_PREFIX        object key prefix   (default: providerbench)
  PB_S3_PATH_STYLE    "false" for virtual-hosted URLs (default: path-style)

Examples:
  providerbench run --provider hetzner --product cloud-vps --plan cax21 \
      --region fsn1 --env os_image=ubuntu-24.04 --json report.json
  providerbench run --quick -t cpu,steal
  providerbench run --category workload     # compression, JSON, TLS, HTTP ...
  providerbench run --category platform     # syscalls, spawn, files, stalls
  providerbench run --category reach        # round trips to nine cloud regions
  providerbench run --profile sustained     # 15 minutes: what survives the burst
  providerbench run -t s3 --provider cloudflare --product r2 \
      --plan standard --region auto --json report.json
  providerbench campaign hetzner --dry-run \
      --campaign hetzner-2026q3 --plan cpx22 --tier medium --region fsn1 \
      --price-hour 0.03808 --price-month 23.7881
  providerbench campaign digitalocean --dry-run \
      --campaign digitalocean-2026q3 --ssh-key-fingerprint SHA256:... \
      --usd-to-eur 0.85
  providerbench campaign vercel --dry-run \
      --campaign vercel-sandbox-2026q3 --vcpus 2 \
      --price-hour 0.2991573034 --price-month 218.3848315 \
      --pricing-as-of 2026-07-23
`

func main() {
	if version == "" {
		version = buildVersion()
	}
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(2)
	}
	switch os.Args[1] {
	case "run":
		os.Exit(runCmd(os.Args[2:]))
	case "campaign":
		os.Exit(campaignCmd(os.Args[2:]))
	case "validate":
		os.Exit(validateCmd(os.Args[2:]))
	case "compare":
		os.Exit(compareCmd(os.Args[2:]))
	case "list":
		for _, b := range bench.All() {
			suite := bench.CategoryOf(b)
			if profile := bench.ProfileOf(b); profile != bench.StandardProfile {
				suite += "/" + profile
			}
			fmt.Printf("  %-15s %-18s %s\n", b.Name(), suite, b.Description())
		}
	case "system":
		info := sysinfo.Collect()
		fmt.Printf("os: %s/%s\nkernel: %s\ncpu: %s (%d cores)\nmemory: %d MB\nvirtualization: %s\n",
			info.OS, info.Arch, info.Kernel, info.CPUModel, info.CPUCores, info.MemTotalMB, info.Virtualization)
	case "version":
		fmt.Println(version)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n%s", os.Args[1], usage)
		os.Exit(2)
	}
}

func buildVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "0.2.0-dev"
	}
	if info.Main.Version != "" && info.Main.Version != "(devel)" {
		return strings.TrimPrefix(info.Main.Version, "v")
	}
	settings := make(map[string]string, len(info.Settings))
	for _, setting := range info.Settings {
		settings[setting.Key] = setting.Value
	}
	revision := settings["vcs.revision"]
	if len(revision) > 12 {
		revision = revision[:12]
	}
	if revision == "" {
		return "0.2.0-dev"
	}
	value := "0.2.0-dev+" + revision
	if settings["vcs.modified"] == "true" {
		value += ".dirty"
	}
	return value
}

// envFlag collects repeatable --env KEY=VALUE pairs.
type envFlag map[string]string

func (e envFlag) String() string { return "" }

func (e envFlag) Set(s string) error {
	key, value, ok := strings.Cut(s, "=")
	if !ok || key == "" {
		return fmt.Errorf("expected KEY=VALUE, got %q", s)
	}
	e[key] = value
	return nil
}

func runCmd(args []string) int {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	var (
		testsFlag     = fs.String("tests", "", "comma-separated tests to run")
		categoryFlag  = fs.String("category", "", "benchmark category (default: inferred)")
		quick         = fs.Bool("quick", false, "faster, less precise runs")
		profileFlag   = fs.String("profile", "", "measurement profile (default: inferred)")
		duration      = fs.Duration("duration", 0, "pilot length of each sustained test")
		jsonPath      = fs.String("json", "", "write JSON report to file (- for stdout)")
		dir           = fs.String("dir", "", "scratch directory for disk tests")
		provider      = fs.String("provider", "", "provider company, e.g. hetzner")
		product       = fs.String("product", "", "offering tested, e.g. cloud-vps")
		plan          = fs.String("plan", "", "plan / instance type")
		tier          = fs.String("tier", "", "price tier: cheap, medium, dedicated")
		region        = fs.String("region", "", "region")
		price         = fs.Float64("price", 0, "monthly price in EUR")
		priceMonth    = fs.Float64("price-month", 0, "monthly price in EUR")
		priceHour     = fs.Float64("price-hour", 0, "hourly price in EUR")
		campaign      = fs.String("campaign", "", "benchmark campaign identifier")
		sampleIndex   = fs.Int("sample-index", 0, "independent host number in campaign")
		repeatIndex   = fs.Int("repeat-index", 0, "repeat number on the host")
		freshInstance = fs.Bool("fresh-instance", false, "sample ran on a newly created instance")
		env           = envFlag{}
	)
	fs.StringVar(testsFlag, "t", "", "alias for --tests")
	fs.Var(env, "env", "KEY=VALUE reproducibility detail (repeatable)")
	fs.Parse(args)

	// Campaign coordinates travel together. Without an explicit sample index,
	// repeats on one machine would be indistinguishable from independent hosts
	// and could inflate a cohort's evidence.
	if *campaign != "" || *sampleIndex != 0 || *repeatIndex != 0 {
		if *campaign == "" || *sampleIndex < 1 || *repeatIndex < 1 {
			fmt.Fprintln(os.Stderr, "--campaign, --sample-index (>= 1), and --repeat-index (>= 1) must be used together")
			return 2
		}
	}
	if !bench.ValidTier(*tier) {
		fmt.Fprintln(os.Stderr, "--tier must be one of: cheap, medium, dedicated, usage-based")
		return 2
	}
	identity := []*string{provider, product, plan, region}
	emptyIdentity := 0
	for _, value := range identity {
		if strings.TrimSpace(*value) == "" {
			emptyIdentity++
		}
	}
	switch emptyIdentity {
	case len(identity):
		*provider = "local"
		*product = "machine"
		*plan = "ad-hoc"
		*region = "local"
	case 0:
	default:
		fmt.Fprintln(os.Stderr, "--provider, --product, --plan and --region must be supplied together")
		return 2
	}

	suite, err := bench.ResolveSuite(*categoryFlag, *profileFlag, *testsFlag, *quick)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	if *duration != 0 {
		if suite.Profile != bench.SustainedProfile {
			fmt.Fprintln(os.Stderr, "--duration applies to the sustained profile only")
			return 2
		}
		if *duration < bench.MinSustainedDuration {
			fmt.Fprintf(os.Stderr, "--duration must be at least %s: the sustained metrics are defined over nine 10 s windows\n", bench.MinSustainedDuration)
			return 2
		}
		if *duration%bench.SustainedWindow != 0 {
			fmt.Fprintf(os.Stderr, "--duration must be a whole number of %s windows\n", bench.SustainedWindow)
			return 2
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	quiet := *jsonPath == "-" // keep stdout clean when the report goes there
	logf := func(format string, a ...any) {
		fmt.Fprintf(os.Stderr, "  "+format+"\n", a...)
	}
	opts := bench.Options{Quick: *quick, Dir: *dir, Log: logf, Duration: *duration}

	monthlyPrice := *priceMonth
	if monthlyPrice == 0 {
		monthlyPrice = *price
	}
	report := &bench.Report{
		SchemaVersion:   bench.SchemaVersion,
		ProtocolVersion: suite.Protocol,
		Profile:         suite.Profile,
		CLIVersion:      version,
		Category:        suite.Category,
		CreatedAt:       time.Now().UTC(),
		Quick:           *quick,
		Provider: bench.Provider{
			Name:          *provider,
			Product:       *product,
			Plan:          *plan,
			Tier:          *tier,
			Region:        *region,
			PriceEURHour:  *priceHour,
			PriceEURMonth: monthlyPrice,
		},
		System: sysinfo.Collect(),
		Measurement: bench.Measurement{
			CampaignID:    *campaign,
			SampleIndex:   *sampleIndex,
			RepeatIndex:   *repeatIndex,
			FreshInstance: *freshInstance,
		},
	}
	if *duration != 0 {
		// A shortened run measures different windows than the protocol
		// defines, so it is an audit-trail pilot, never cohort evidence.
		report.Measurement.ExcludeFromAggregate = true
		env["sustained_duration"] = duration.String()
	}
	// The benchmarks are compiled Go, so the toolchain is part of the
	// method: a cohort must come from one release. It is a fact about this
	// binary, so it is not open to --env.
	env[bench.GoVersionKey] = runtime.Version()
	report.Environment = env

	exitCode := 0
	for _, b := range suite.Tests {
		if ctx.Err() != nil {
			break
		}
		fmt.Fprintf(os.Stderr, "\n▸ %s — %s\n", b.Name(), b.Description())
		attemptStarted := time.Now().UTC()
		res, err := b.Run(ctx, opts)
		if res == nil {
			res = &bench.Result{Test: b.Name(), StartedAt: attemptStarted, Metrics: []bench.Metric{}}
		}
		if res.StartedAt.IsZero() {
			res.StartedAt = attemptStarted
		}
		if res.DurationSeconds <= 0 {
			res.DurationSeconds = time.Since(attemptStarted).Seconds()
		}
		if err != nil {
			res.Error = err.Error()
			res.Metrics = []bench.Metric{}
			if ctx.Err() == nil {
				exitCode = 1
				fmt.Fprintf(os.Stderr, "  failed: %v\n", err)
			}
		} else if len(res.Metrics) == 0 {
			exitCode = 1
			res.Error = "benchmark returned no metrics"
			res.Metrics = []bench.Metric{}
			fmt.Fprintf(os.Stderr, "  failed: %s\n", res.Error)
		}
		report.Results = append(report.Results, *res)
	}
	if len(report.Results) == 0 {
		runErr := "no benchmark was executed"
		if ctx.Err() != nil {
			runErr = ctx.Err().Error()
		}
		report.Results = append(report.Results, bench.Result{
			Test:            "run",
			StartedAt:       report.CreatedAt,
			DurationSeconds: time.Since(report.CreatedAt).Seconds(),
			Metrics:         []bench.Metric{},
			Error:           runErr,
		})
	}

	if !quiet {
		output.PrintReport(os.Stdout, report)
	}

	// A machine-readable report is always written — the JSON is the product;
	// the table above is just a human preview.
	if *jsonPath == "" {
		name := *provider
		if name == "" {
			name = "run"
		}
		*jsonPath = fmt.Sprintf("providerbench-%s-%s.json", name, report.CreatedAt.Format("20060102-150405"))
	}

	if *jsonPath != "" {
		data, err := report.JSON()
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode report:", err)
			return 1
		}
		if _, errs := bench.ValidateReport(data); len(errs) > 0 {
			for _, err := range errs {
				fmt.Fprintln(os.Stderr, "validate report:", err)
			}
			return 1
		}
		if *jsonPath == "-" {
			os.Stdout.Write(data)
		} else if err := os.WriteFile(*jsonPath, data, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "write report:", err)
			return 1
		} else if !quiet {
			fmt.Fprintf(os.Stdout, "\nreport written to %s — submit it at https://github.com/niklas-schmidt-dev/providerbench\n", *jsonPath)
		}
	}
	if ctx.Err() != nil {
		fmt.Fprintln(os.Stderr, "\ninterrupted")
		return 130
	}
	return exitCode
}
