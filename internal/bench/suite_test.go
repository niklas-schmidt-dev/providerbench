package bench

import (
	"context"
	"testing"
)

type suiteProbe struct {
	name, category, profile string
}

func (p suiteProbe) Name() string        { return p.name }
func (p suiteProbe) Description() string { return "test double" }
func (p suiteProbe) Run(context.Context, Options) (*Result, error) {
	return NewResult(p.name), nil
}

type categorizedProbe struct{ suiteProbe }

func (p categorizedProbe) Category() string { return p.category }

type profiledProbe struct{ categorizedProbe }

func (p profiledProbe) Profile() string { return p.profile }

func TestSuiteSelectsByCategoryAndProfile(t *testing.T) {
	saved := registry
	t.Cleanup(func() { registry = saved })
	registry = nil
	Register(suiteProbe{name: "plain"})
	Register(categorizedProbe{suiteProbe{name: "other", category: "workload"}})
	Register(profiledProbe{categorizedProbe{suiteProbe{name: "long", category: "compute", profile: SustainedProfile}}})

	names := func(bs []Benchmark) []string {
		out := make([]string, len(bs))
		for i, b := range bs {
			out[i] = b.Name()
		}
		return out
	}
	if got := names(Suite("compute", StandardProfile)); len(got) != 1 || got[0] != "plain" {
		t.Errorf("standard compute suite = %v, want [plain]", got)
	}
	if got := names(Suite("compute", SustainedProfile)); len(got) != 1 || got[0] != "long" {
		t.Errorf("sustained compute suite = %v, want [long]", got)
	}
	if got := names(Suite("workload", StandardProfile)); len(got) != 1 || got[0] != "other" {
		t.Errorf("workload suite = %v, want [other]", got)
	}
	if got := Suite("workload", SustainedProfile); len(got) != 0 {
		t.Errorf("workload has no sustained tests, got %v", names(got))
	}
}

func TestEveryPinnedCategoryValidatesOnlyWithItsProtocol(t *testing.T) {
	for category, protocol := range map[string]string{
		"compute": ComputeProtocol, "storage": StorageProtocol,
		"workload": WorkloadProtocol, "platform": PlatformProtocol, "reach": ReachProtocol,
	} {
		if got, ok := ProtocolFor(category); !ok || got != protocol {
			t.Errorf("ProtocolFor(%q) = %q, %v; want %q", category, got, ok, protocol)
		}
		report := validReport()
		report.Category = category
		report.ProtocolVersion = protocol
		if _, errs := ValidateReport(mustJSON(t, report)); len(errs) != 0 {
			t.Errorf("%s report with %s rejected: %v", category, protocol, errs)
		}
		report.ProtocolVersion = "someone-elses-v9"
		if _, errs := ValidateReport(mustJSON(t, report)); len(errs) == 0 {
			t.Errorf("%s report with a foreign protocol was accepted", category)
		}
	}
	if _, ok := ProtocolFor("unheard-of"); ok {
		t.Error("an unknown category must not resolve to a protocol")
	}
}

func TestResultFinishRoundsToTwoDecimals(t *testing.T) {
	res := NewResult("probe")
	res.Add("value", 12.3456, "ms", false)
	res.Finish()
	if res.Metrics[0].Value != 12.35 {
		t.Errorf("value = %v, want 12.35", res.Metrics[0].Value)
	}
	if res.StartedAt.IsZero() || res.DurationSeconds < 0 {
		t.Errorf("result timing is incomplete: %+v", res)
	}
}

type conditionalProbe struct {
	categorizedProbe
	reason string
}

func (p conditionalProbe) Unavailable() string { return p.reason }

// A test that cannot run here stays in the catalog, so the catalog is the
// same on every system, but no suite runs it and naming it says why.
func TestUnavailableTestsStayListedButNeverRun(t *testing.T) {
	saved := registry
	t.Cleanup(func() { registry = saved })
	registry = nil
	Register(categorizedProbe{suiteProbe{name: "always", category: "platform"}})
	Register(conditionalProbe{categorizedProbe{suiteProbe{name: "elsewhere", category: "platform"}}, "it needs another system"})
	Register(conditionalProbe{categorizedProbe{suiteProbe{name: "here", category: "platform"}}, ""})

	var suite []string
	for _, b := range Suite("platform", StandardProfile) {
		suite = append(suite, b.Name())
	}
	if len(suite) != 2 || suite[0] != "always" || suite[1] != "here" {
		t.Errorf("suite = %v, want [always here]", suite)
	}

	if _, err := Select([]string{"elsewhere"}); err == nil || err.Error() != `test "elsewhere" cannot run here: it needs another system` {
		t.Errorf("Select(elsewhere) error = %v", err)
	}
	if got, err := Select([]string{"here", "always"}); err != nil || len(got) != 2 {
		t.Errorf("Select(here, always) = %v, %v", got, err)
	}

	catalog := BuildCatalog()
	if len(catalog.Categories) != 1 || len(catalog.Categories[0].Tests) != 3 || catalog.Categories[0].Tests[1].Name != "elsewhere" {
		t.Errorf("catalog = %+v, want all three tests in registration order", catalog.Categories)
	}
}
