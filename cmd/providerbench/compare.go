package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

const compareUsage = `Compare two selections of reports, metric by metric.

Usage:
  providerbench compare --a FILTER --b FILTER [flags] FILE|DIR ...

Each filter is a comma-separated key=value list. Keys: provider, product,
plan, region, campaign, and cpu (a substring of the reported CPU model).
A is the baseline; every difference reads "B relative to A".

Flags:
      --a FILTER            selection A, e.g. plan=cpx22,region=fsn1
      --b FILTER            selection B, e.g. plan=ccx13
      --json                print the comparison as JSON
      --resamples N         bootstrap resamples (default 10000)
      --across-protocols    allow selections measured under different
                            protocol versions; methodology may differ

How to read it: repeats on one host collapse to their median, then each side
is summarised across hosts. "B vs A" is the ratio of the two medians. The
interval is a 95% percentile bootstrap over hosts — with ten hosts a side it
is indicative, not exact. A verdict is given only when the whole interval
lies on one side of "no change".

Examples:
  providerbench compare data/results \
      --a plan=cpx22,region=fsn1,campaign=hetzner-2026-07-24-v2 \
      --b plan=ccx13,campaign=hetzner-2026-07-24-v2
  providerbench compare data/results --across-protocols \
      --a plan=cx23,cpu=skylake --b plan=cx23,cpu=rome
`

// filterFlag accumulates repeated --a / --b values into one filter spec.
type filterFlag []string

func (f *filterFlag) String() string     { return strings.Join(*f, ",") }
func (f *filterFlag) Set(v string) error { *f = append(*f, v); return nil }

func compareCmd(args []string) int {
	fs := flag.NewFlagSet("compare", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var specA, specB filterFlag
	fs.Var(&specA, "a", "selection A (repeatable)")
	fs.Var(&specB, "b", "selection B (repeatable)")
	asJSON := fs.Bool("json", false, "print the comparison as JSON")
	resamples := fs.Int("resamples", 10000, "bootstrap resamples")
	acrossProtocols := fs.Bool("across-protocols", false, "allow different protocol versions")
	fs.Usage = func() { fmt.Fprint(fs.Output(), compareUsage) }
	// Flags and report paths may be given in any order: the standard parser
	// stops at the first path, so resume after each one.
	var paths []string
	for rest := args; ; {
		if err := fs.Parse(rest); err != nil {
			if err == flag.ErrHelp {
				return 0
			}
			return 2
		}
		if fs.NArg() == 0 {
			break
		}
		paths = append(paths, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if len(specA) == 0 || len(specB) == 0 || len(paths) == 0 {
		fmt.Fprint(os.Stderr, compareUsage)
		return 2
	}
	filterA, err := bench.ParseFilter(specA.String())
	if err != nil {
		fmt.Fprintln(os.Stderr, "--a:", err)
		return 2
	}
	filterB, err := bench.ParseFilter(specB.String())
	if err != nil {
		fmt.Fprintln(os.Stderr, "--b:", err)
		return 2
	}

	reports, err := loadReports(paths)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var sideA, sideB []bench.NamedReport
	for _, nr := range reports {
		inA, inB := filterA.Matches(nr.Report), filterB.Matches(nr.Report)
		if inA && inB {
			fmt.Fprintf(os.Stderr, "%s matches both selections — make the filters disjoint\n", nr.Name)
			return 2
		}
		if inA {
			sideA = append(sideA, nr)
		}
		if inB {
			sideB = append(sideB, nr)
		}
	}

	comparison, err := bench.Compare(sideA, sideB, *resamples, *acrossProtocols)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if *asJSON {
		data, err := json.MarshalIndent(comparison, "", "  ")
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode comparison:", err)
			return 1
		}
		os.Stdout.Write(append(data, '\n'))
		return 0
	}
	printComparison(os.Stdout, comparison)
	return 0
}

// loadReports reads every report under the given files and directories,
// sorted by name so results never depend on argument or directory order.
func loadReports(args []string) ([]bench.NamedReport, error) {
	var paths []string
	for _, arg := range args {
		info, err := os.Stat(arg)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			paths = append(paths, arg)
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(arg, "*.json"))
		if len(matches) == 0 {
			return nil, fmt.Errorf("%s: no .json reports found", arg)
		}
		paths = append(paths, matches...)
	}
	sort.Strings(paths)
	reports := make([]bench.NamedReport, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		report, errs := bench.ValidateReport(data)
		if len(errs) > 0 {
			return nil, fmt.Errorf("%s: %w", path, errs[0])
		}
		reports = append(reports, bench.NamedReport{Name: filepath.Base(path), Report: report})
	}
	return reports, nil
}

func printComparison(w io.Writer, c *bench.Comparison) {
	side := func(label string, s bench.SideSummary) {
		fmt.Fprintf(w, "%s: %d hosts, %d reports\n", label, s.Hosts, s.Reports)
		for _, cohort := range s.Cohorts {
			fmt.Fprintf(w, "     %s\n", cohort)
		}
		if len(s.CPUModels) > 0 {
			fmt.Fprintf(w, "     cpu: %s\n", strings.Join(s.CPUModels, "; "))
		}
	}
	side("A", c.A)
	side("B", c.B)
	fmt.Fprintf(w, "suite: %s/%s · protocol %s\n", c.Category, c.Profile, strings.Join(c.Protocols, ", "))
	if len(c.Protocols) > 1 {
		fmt.Fprintln(w, "warning: the selections were measured under different protocol versions; a difference can be the method, not the machine")
	}
	fmt.Fprintln(w)

	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "METRIC\tUNIT\tA P50\tB P50\tB VS A\t95% INTERVAL\tVERDICT\t")
	for _, m := range c.Metrics {
		change, interval := "–", "–"
		if m.Ratio != nil {
			change = percentChange(*m.Ratio)
		}
		if m.Low != nil && m.High != nil {
			interval = percentChange(*m.Low) + " … " + percentChange(*m.High)
		}
		direction := "↓ better"
		if m.HigherIsBetter {
			direction = "↑ better"
		}
		fmt.Fprintf(tw, "%s.%s\t%s %s\t%s\t%s\t%s\t%s\t%s\t\n",
			m.Test, m.Metric, m.Unit, direction,
			compactNumber(m.A.P50), compactNumber(m.B.P50), change, interval, m.Verdict)
	}
	tw.Flush()
	fmt.Fprintf(w, "\nB vs A is the ratio of host medians; the interval is a %d-resample bootstrap over hosts.\n", c.Resamples)
}

func percentChange(ratio float64) string {
	return fmt.Sprintf("%+.1f%%", (ratio-1)*100)
}

func compactNumber(v float64) string {
	switch abs := max(v, -v); {
	case abs >= 1000:
		return fmt.Sprintf("%.0f", v)
	case abs >= 10:
		return fmt.Sprintf("%.1f", v)
	default:
		return fmt.Sprintf("%.2f", v)
	}
}
