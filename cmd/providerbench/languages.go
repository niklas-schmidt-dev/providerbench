package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"text/tabwriter"

	"github.com/niklas-schmidt-dev/providerbench/internal/tests/ai"
)

const languagesUsage = `Compare ai-language reports: what each model solved in each input language.

Usage:
  providerbench languages [--json] FILE|DIR ...

One row per report; reports of other categories are skipped. Each language
shows the share of all problems the model solved. The number in brackets is
the difference to English in percentage points, and a * marks a difference
whose 95% interval lies on one side of zero. The interval is a paired
bootstrap over problems: every problem is asked in every language.

Quick reports ask a quarter of the problems; do not rank them against full
ones. A report that lacks a test of the suite says so next to its number of
problems, and is not about the same problems as a complete one.

Example:
  providerbench languages reports/
`

// languageRow is one report in the comparison.
type languageRow struct {
	File     string      `json:"file"`
	Provider string      `json:"provider"`
	Model    string      `json:"model"`
	Effort   string      `json:"effort,omitempty"`
	Quick    bool        `json:"quick,omitempty"`
	Summary  *ai.Summary `json:"summary"`
}

func languagesCmd(args []string) int {
	fs := flag.NewFlagSet("languages", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	asJSON := fs.Bool("json", false, "print the comparison as JSON")
	fs.Usage = func() { fmt.Fprint(fs.Output(), languagesUsage) }
	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 2
	}
	if fs.NArg() == 0 {
		fmt.Fprint(os.Stderr, languagesUsage)
		return 2
	}
	reports, err := loadReports(fs.Args())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	var rows []languageRow
	for _, nr := range reports {
		summary, ok := ai.Summarize(nr.Report)
		if !ok {
			continue
		}
		rows = append(rows, languageRow{
			File:     nr.Name,
			Provider: nr.Report.Provider.Name,
			Model:    nr.Report.Provider.Plan,
			Effort:   nr.Report.Environment["ai_effort"],
			Quick:    nr.Report.Quick,
			Summary:  summary,
		})
	}
	if len(rows) == 0 {
		fmt.Fprintln(os.Stderr, "no ai-language reports with outcomes among the given files")
		return 1
	}
	if *asJSON {
		data, err := json.MarshalIndent(rows, "", "  ")
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode comparison:", err)
			return 1
		}
		os.Stdout.Write(append(data, '\n'))
		return 0
	}
	printLanguages(os.Stdout, rows)
	return 0
}

func printLanguages(w io.Writer, rows []languageRow) {
	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	fmt.Fprint(tw, "MODEL\tEFFORT\tPROBLEMS\t")
	for _, l := range rows[0].Summary.Languages {
		fmt.Fprintf(tw, "%s\t", l.Name)
	}
	fmt.Fprintln(tw, "FILE\t")
	for _, row := range rows {
		problems := fmt.Sprint(row.Summary.Problems)
		if row.Quick {
			problems += " (quick)"
		}
		if coverage := row.Summary.Coverage(); coverage != "" {
			problems += ", " + coverage
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t", row.Model, row.Effort, problems)
		for _, l := range row.Summary.Languages {
			cell := fmt.Sprintf("%.1f%%", l.Accuracy)
			if !l.Baseline {
				mark := ""
				if l.Verdict != ai.VerdictNone {
					mark = " *"
				}
				cell += fmt.Sprintf(" (%+.1f%s)", l.Difference, mark)
			}
			fmt.Fprintf(tw, "%s\t", cell)
		}
		fmt.Fprintf(tw, "%s\t\n", row.File)
	}
	tw.Flush()
	fmt.Fprintln(w, "\nBrackets: difference to English in percentage points; * = the 95% interval lies on one side of zero.")
}
