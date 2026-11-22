package bench

import "sort"

// CatalogVersion is the format version of the catalog file.
const CatalogVersion = 1

// CatalogTest describes one registered benchmark.
type CatalogTest struct {
	Name        string `json:"name"`
	Profile     string `json:"profile"`
	Description string `json:"description"`
}

// CatalogCategory is one report category with the tests that belong to it.
type CatalogCategory struct {
	Name     string        `json:"name"`
	Protocol string        `json:"protocol,omitempty"`
	Tests    []CatalogTest `json:"tests"`
}

// Catalog lists what this binary can measure. The website reads it from
// data/catalog.json, so a new suite gets its page and its descriptions without
// a change to the site.
type Catalog struct {
	CatalogVersion int               `json:"catalog_version"`
	Categories     []CatalogCategory `json:"categories"`
}

// BuildCatalog describes every registered benchmark. Categories are sorted by
// name; tests keep registration order, the order a run executes them in.
func BuildCatalog() Catalog {
	byName := make(map[string]*CatalogCategory)
	var names []string
	for _, b := range registry {
		name := CategoryOf(b)
		category, ok := byName[name]
		if !ok {
			protocol, _ := ProtocolFor(name)
			category = &CatalogCategory{Name: name, Protocol: protocol}
			byName[name] = category
			names = append(names, name)
		}
		category.Tests = append(category.Tests, CatalogTest{
			Name:        b.Name(),
			Profile:     ProfileOf(b),
			Description: b.Description(),
		})
	}
	sort.Strings(names)
	catalog := Catalog{CatalogVersion: CatalogVersion, Categories: make([]CatalogCategory, 0, len(names))}
	for _, name := range names {
		catalog.Categories = append(catalog.Categories, *byName[name])
	}
	return catalog
}
