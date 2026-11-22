package main

import (
	"bytes"
	"encoding/json"
	"sort"
	"testing"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// The catalog is what the website builds its pages from: every registered
// test appears once, under its category, with the protocol of that category.
func TestCatalogDescribesEveryRegisteredTest(t *testing.T) {
	var out bytes.Buffer
	if err := writeCatalog(&out); err != nil {
		t.Fatal(err)
	}
	var catalog bench.Catalog
	if err := json.Unmarshal(out.Bytes(), &catalog); err != nil {
		t.Fatalf("catalog is not JSON: %v", err)
	}
	if catalog.CatalogVersion != bench.CatalogVersion {
		t.Errorf("catalog_version = %d, want %d", catalog.CatalogVersion, bench.CatalogVersion)
	}

	var names []string
	seen := make(map[string]string)
	for _, category := range catalog.Categories {
		names = append(names, category.Name)
		if want, _ := bench.ProtocolFor(category.Name); category.Protocol != want {
			t.Errorf("%s: protocol = %q, want %q", category.Name, category.Protocol, want)
		}
		for _, test := range category.Tests {
			if other, dup := seen[test.Name]; dup {
				t.Errorf("test %q is listed under %s and %s", test.Name, other, category.Name)
			}
			seen[test.Name] = category.Name
			if test.Description == "" || test.Profile == "" {
				t.Errorf("%s/%s lacks a description or a profile", category.Name, test.Name)
			}
		}
	}
	if !sort.StringsAreSorted(names) {
		t.Errorf("categories are not sorted: %v", names)
	}
	for _, b := range bench.All() {
		if seen[b.Name()] != bench.CategoryOf(b) {
			t.Errorf("test %q: catalog category %q, want %q", b.Name(), seen[b.Name()], bench.CategoryOf(b))
		}
	}
	if len(seen) != len(bench.All()) {
		t.Errorf("catalog lists %d tests, the registry holds %d", len(seen), len(bench.All()))
	}
}
