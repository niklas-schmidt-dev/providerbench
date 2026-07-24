package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// validateCmd checks report files against the schema and, for dataset files,
// the data/results submission conventions. Directory arguments always use the
// dataset rules; CI runs `providerbench validate data/results` on every push.
func validateCmd(args []string) int {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	dataset := fs.Bool("dataset", false, "apply data/results submission rules to file arguments too")
	fs.Parse(args)
	if fs.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: providerbench validate [--dataset] FILE|DIR ...")
		return 2
	}

	type target struct {
		path    string
		dataset bool
	}
	var targets []target
	for _, arg := range fs.Args() {
		info, err := os.Stat(arg)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		if !info.IsDir() {
			targets = append(targets, target{arg, *dataset})
			continue
		}
		matches, _ := filepath.Glob(filepath.Join(arg, "*.json"))
		if len(matches) == 0 {
			fmt.Fprintf(os.Stderr, "%s: no .json reports found\n", arg)
			return 2
		}
		for _, m := range matches {
			targets = append(targets, target{m, true})
		}
	}

	failed := 0
	for _, t := range targets {
		data, err := os.ReadFile(t.path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			failed++
			continue
		}
		report, errs := bench.ValidateReport(data)
		if report != nil && t.dataset {
			errs = append(errs, bench.DatasetErrors(report, filepath.Base(t.path))...)
		}
		if len(errs) > 0 {
			failed++
			for _, e := range errs {
				fmt.Fprintf(os.Stderr, "%s: %v\n", t.path, e)
			}
		}
	}
	if failed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d of %d reports failed validation\n", failed, len(targets))
		return 1
	}
	fmt.Printf("%d reports valid\n", len(targets))
	return 0
}
