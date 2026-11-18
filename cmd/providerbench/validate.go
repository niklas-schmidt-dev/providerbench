package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// validateCmd checks report files against the schema and, for dataset files,
// the data/results submission conventions. Directory arguments always use the
// dataset rules; CI runs `providerbench validate data/results` on every push.
func validateCmd(args []string) int {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	dataset := fs.Bool("dataset", false, "apply data/results submission rules to file arguments too")
	manifestPath := fs.String("manifest", "", "write a deterministic validated dataset manifest")
	fs.Parse(args)
	if fs.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: providerbench validate [--dataset] [--manifest FILE] FILE|DIR ...")
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
	sort.Slice(targets, func(i, j int) bool { return targets[i].path < targets[j].path })

	var datasetFiles []bench.DatasetFile
	var plainFiles []target
	for _, t := range targets {
		data, err := os.ReadFile(t.path)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if t.dataset {
			datasetFiles = append(datasetFiles, bench.DatasetFile{
				Name: filepath.Base(t.path),
				Data: data,
			})
		} else {
			plainFiles = append(plainFiles, t)
		}
	}

	var problems []error
	for _, t := range plainFiles {
		data, err := os.ReadFile(t.path)
		if err != nil {
			problems = append(problems, fmt.Errorf("%s: %w", t.path, err))
			continue
		}
		_, errs := bench.ValidateReport(data)
		if len(errs) > 0 {
			for _, e := range errs {
				problems = append(problems, fmt.Errorf("%s: %w", t.path, e))
			}
		}
	}

	var manifest *bench.DatasetManifest
	if len(datasetFiles) > 0 {
		var datasetErrs []error
		manifest, datasetErrs = bench.ValidateDataset(datasetFiles)
		problems = append(problems, datasetErrs...)
	}
	if *manifestPath != "" && len(datasetFiles) == 0 {
		fmt.Fprintln(os.Stderr, "--manifest requires at least one dataset target (a directory or --dataset file)")
		return 2
	}
	if len(problems) > 0 {
		for _, problem := range problems {
			fmt.Fprintln(os.Stderr, problem)
		}
		fmt.Fprintf(os.Stderr, "\nvalidation failed with %d problem(s)\n", len(problems))
		return 1
	}

	if *manifestPath != "" {
		data, err := manifest.JSON()
		if err != nil {
			fmt.Fprintln(os.Stderr, "encode manifest:", err)
			return 1
		}
		if err := writeAtomic(*manifestPath, data); err != nil {
			fmt.Fprintln(os.Stderr, "write manifest:", err)
			return 1
		}
		fmt.Printf("manifest written to %s\n", *manifestPath)
	}
	fmt.Printf("%d reports valid\n", len(targets))
	return 0
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".providerbench-manifest-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}
