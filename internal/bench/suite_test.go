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
