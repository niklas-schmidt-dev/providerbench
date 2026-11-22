package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func listCmd(args []string) int {
	fs := flag.NewFlagSet("list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "print the test catalog as JSON, the form data/catalog.json holds")
	fs.Parse(args)
	if fs.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "usage: providerbench list [--json]")
		return 2
	}
	if *asJSON {
		if err := writeCatalog(os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	for _, b := range bench.All() {
		suite := bench.CategoryOf(b)
		if profile := bench.ProfileOf(b); profile != bench.StandardProfile {
			suite += "/" + profile
		}
		description := b.Description()
		if reason := bench.Unavailable(b); reason != "" {
			description += " (not on this system: " + reason + ")"
		}
		fmt.Printf("  %-15s %-18s %s\n", b.Name(), suite, description)
	}
	return 0
}

func writeCatalog(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(bench.BuildCatalog())
}
