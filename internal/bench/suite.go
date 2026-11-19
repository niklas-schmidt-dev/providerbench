package bench

import (
	"errors"
	"fmt"
	"strings"
)

// SuiteSelection is the resolved identity of one run: which tests execute and the
// category, profile and protocol their report is published under.
type SuiteSelection struct {
	Category string
	Profile  string
	Protocol string
	Tests    []Benchmark
}

// ResolveSuite turns the user's --category, --profile and --tests into the
// tests to run. A report holds exactly one category and one profile, so
// named tests pin both and must agree with each other; a category and profile
// alone select that suite in full; nothing at all means the original compute
// run. Campaign runners call this before creating any billable resource.
func ResolveSuite(category, profile, tests string, quick bool) (SuiteSelection, error) {
	switch profile {
	case "", StandardProfile, SustainedProfile:
	default:
		return SuiteSelection{}, errors.New("--profile must be one of: standard, sustained")
	}

	var selected []Benchmark
	if tests != "" {
		var err error
		selected, err = Select(strings.Split(tests, ","))
		if err != nil {
			return SuiteSelection{}, err
		}
		for _, b := range selected {
			c := CategoryOf(b)
			if category == "" {
				category = c
			}
			if c != category {
				return SuiteSelection{}, fmt.Errorf("test %q belongs to category %q — a report holds one category, run it separately", b.Name(), c)
			}
			p := ProfileOf(b)
			if profile == "" {
				profile = p
			}
			if p != profile {
				return SuiteSelection{}, fmt.Errorf("test %q belongs to profile %q — a report holds one profile, run it separately", b.Name(), p)
			}
		}
	} else {
		if category == "" {
			category = "compute"
		}
		if profile == "" {
			profile = StandardProfile
		}
		selected = Suite(category, profile)
		if len(selected) == 0 {
			return SuiteSelection{}, fmt.Errorf("no %s-profile tests in category %q (run `providerbench list`)", profile, category)
		}
	}
	if profile == SustainedProfile && quick {
		return SuiteSelection{}, errors.New("--quick does not apply to the sustained profile; use --duration for a shorter pilot")
	}
	protocol, ok := ProtocolFor(category)
	if !ok {
		return SuiteSelection{}, fmt.Errorf("category %q has no pinned protocol — add it to bench.ProtocolFor", category)
	}
	return SuiteSelection{Category: category, Profile: profile, Protocol: protocol, Tests: selected}, nil
}
