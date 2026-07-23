// Package output renders benchmark results for the terminal.
package output

import (
	"fmt"
	"io"
	"strconv"
	"strings"
	"text/tabwriter"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func PrintReport(w io.Writer, r *bench.Report) {
	fmt.Fprintf(w, "\nproviderbench v%s — %s/%s", r.CLIVersion, r.System.OS, r.System.Arch)
	if r.System.CPUModel != "" {
		fmt.Fprintf(w, ", %s", r.System.CPUModel)
	}
	fmt.Fprintf(w, ", %d cores", r.System.CPUCores)
	if r.System.MemTotalMB > 0 {
		fmt.Fprintf(w, ", %.1f GiB RAM", float64(r.System.MemTotalMB)/1024)
	}
	fmt.Fprintln(w)
	if r.Provider.Name != "" {
		fmt.Fprintf(w, "provider: %s", r.Provider.Name)
		if r.Provider.Plan != "" {
			fmt.Fprintf(w, " %s", r.Provider.Plan)
		}
		if r.Provider.Region != "" {
			fmt.Fprintf(w, " (%s)", r.Provider.Region)
		}
		fmt.Fprintln(w)
	}

	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	for _, res := range r.Results {
		fmt.Fprintf(tw, "\n%s\t(%.1fs)\t\n", strings.ToUpper(res.Test), res.DurationSeconds)
		if res.Error != "" {
			fmt.Fprintf(tw, "  error\t%s\t\n", res.Error)
			continue
		}
		for _, m := range res.Metrics {
			fmt.Fprintf(tw, "  %s\t%s %s\t\n", m.Name, formatValue(m.Value), m.Unit)
		}
		for _, n := range res.Notes {
			fmt.Fprintf(tw, "  note\t%s\t\n", n)
		}
	}
	tw.Flush()
}

func formatValue(v float64) string {
	switch {
	case v >= 1000:
		return humanInt(int64(v + 0.5))
	case v >= 10:
		return strconv.FormatFloat(v, 'f', 1, 64)
	default:
		return strconv.FormatFloat(v, 'f', 2, 64)
	}
}

func humanInt(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return b.String()
}
