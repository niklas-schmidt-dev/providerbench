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
	"strings"
	"syscall"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/output"
	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
	_ "github.com/niklas-schmidt-dev/providerbench/internal/tests/compute" // registers built-in tests
)

// version is overridden at release time via -ldflags "-X main.version=...".
var version = "0.2.0-dev"

const usage = `providerbench — open benchmark for VPS & server providers

Usage:
  providerbench run [flags]   run benchmarks
  providerbench campaign hetzner [flags]
                              create, benchmark, and remove a Hetzner cohort
  providerbench campaign vercel [flags]
                              benchmark fresh Vercel Sandbox samples
  providerbench list          list available tests
  providerbench system        show detected system info
  providerbench version       print version

Run flags:
  -t, --tests cpu,disk    comma-separated tests to run (default: all)
      --quick             faster, less precise runs
      --json FILE         where to write the JSON report; "-" prints it to
                          stdout with no table (default: providerbench-<provider>-<time>.json)
      --dir DIR           scratch directory for disk tests (default: current dir)
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

Examples:
  providerbench run --provider hetzner --product cloud-vps --plan cax21 \
      --region fsn1 --env os_image=ubuntu-24.04 --json report.json
  providerbench run --quick -t cpu,steal
  providerbench campaign hetzner --dry-run \
      --campaign hetzner-2026q3 --plan cpx22 --tier medium --region fsn1 \
      --price-hour 0.03808 --price-month 23.7881
  providerbench campaign vercel --dry-run \
      --campaign vercel-sandbox-2026q3 --vcpus 2 \
      --price-hour 0.2991573034 --price-month 218.3848315 \
      --pricing-as-of 2026-07-23
`

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(2)
	}
	switch os.Args[1] {
	case "run":
		os.Exit(runCmd(os.Args[2:]))
	case "campaign":
		os.Exit(campaignCmd(os.Args[2:]))
	case "list":
		for _, b := range bench.All() {
			fmt.Printf("  %-10s %s\n", b.Name(), b.Description())
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

// validTier reports whether tier is empty or one of the schema's price tiers.
func validTier(tier string) bool {
	switch tier {
	case "", "cheap", "medium", "dedicated", "usage-based":
		return true
	}
	return false
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
		quick         = fs.Bool("quick", false, "faster, less precise runs")
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
	if !validTier(*tier) {
		fmt.Fprintln(os.Stderr, "--tier must be one of: cheap, medium, dedicated, usage-based")
		return 2
	}

	selected := bench.All()
	if *testsFlag != "" {
		var err error
		selected, err = bench.Select(strings.Split(*testsFlag, ","))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	quiet := *jsonPath == "-" // keep stdout clean when the report goes there
	logf := func(format string, a ...any) {
		fmt.Fprintf(os.Stderr, "  "+format+"\n", a...)
	}
	opts := bench.Options{Quick: *quick, Dir: *dir, Log: logf}

	monthlyPrice := *priceMonth
	if monthlyPrice == 0 {
		monthlyPrice = *price
	}
	report := &bench.Report{
		SchemaVersion: bench.SchemaVersion,
		CLIVersion:    version,
		Category:      "compute",
		CreatedAt:     time.Now().UTC(),
		Quick:         *quick,
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
	if len(env) > 0 {
		report.Environment = env
	}

	exitCode := 0
	for _, b := range selected {
		if ctx.Err() != nil {
			break
		}
		fmt.Fprintf(os.Stderr, "\n▸ %s — %s\n", b.Name(), b.Description())
		res, err := b.Run(ctx, opts)
		if res == nil {
			res = &bench.Result{Test: b.Name()}
		}
		if err != nil && ctx.Err() == nil {
			exitCode = 1
			res.Error = err.Error()
			fmt.Fprintf(os.Stderr, "  failed: %v\n", err)
		}
		report.Results = append(report.Results, *res)
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
