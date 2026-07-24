package bench

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
)

func validReport() *Report {
	started := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	return &Report{
		SchemaVersion: SchemaVersion,
		CLIVersion:    "test",
		Category:      "compute",
		CreatedAt:     started,
		Provider: Provider{
			Name: "hetzner", Product: "cloud-vps", Plan: "cpx22", Tier: "medium",
			Region: "fsn1", PriceEURHour: 0.032, PriceEURMonth: 19.99,
		},
		System:      sysinfo.Info{OS: "linux", Arch: "amd64", CPUCores: 2, MemTotalMB: 3840},
		Measurement: Measurement{CampaignID: "hetzner-2026q3", SampleIndex: 2, RepeatIndex: 1, FreshInstance: true},
		Results: []Result{{
			Test: "cpu", StartedAt: started, DurationSeconds: 3,
			Metrics: []Metric{{Name: "single_core_hash", Value: 1500, Unit: "MB/s", HigherIsBetter: true}},
		}},
	}
}

func mustJSON(t *testing.T, r *Report) []byte {
	t.Helper()
	data, err := r.JSON()
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func hasError(errs []error, substring string) bool {
	for _, err := range errs {
		if strings.Contains(err.Error(), substring) {
			return true
		}
	}
	return false
}

func TestValidateReportOK(t *testing.T) {
	report, errs := ValidateReport(mustJSON(t, validReport()))
	if report == nil || len(errs) != 0 {
		t.Fatalf("valid report rejected: %v", errs)
	}
}

func TestValidateReportRejectsUnknownFields(t *testing.T) {
	var m map[string]any
	if err := json.Unmarshal(mustJSON(t, validReport()), &m); err != nil {
		t.Fatal(err)
	}
	m["hostname"] = "leaked"
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, errs := ValidateReport(data); !hasError(errs, "parse") {
		t.Fatalf("unknown field accepted: %v", errs)
	}
}

func TestValidateReportProblems(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Report)
		want   string
	}{
		{"wrong schema version", func(r *Report) { r.SchemaVersion = 2 }, "schema_version"},
		{"missing cli version", func(r *Report) { r.CLIVersion = "" }, "cli_version"},
		{"missing category", func(r *Report) { r.Category = "" }, "category"},
		{"missing created_at", func(r *Report) { r.CreatedAt = time.Time{} }, "created_at"},
		{"invalid tier", func(r *Report) { r.Provider.Tier = "premium" }, "tier"},
		{"negative price", func(r *Report) { r.Provider.PriceEURMonth = -1 }, "negative"},
		{"missing system", func(r *Report) { r.System.OS = "" }, "system.os"},
		{"zero cores", func(r *Report) { r.System.CPUCores = 0 }, "cpu_cores"},
		{"incomplete coordinates", func(r *Report) { r.Measurement.SampleIndex = 0 }, "travel together"},
		{"missing results", func(r *Report) { r.Results = nil }, "results is missing"},
		{"unnamed test", func(r *Report) { r.Results[0].Test = "" }, "test name"},
		{"missing started_at", func(r *Report) { r.Results[0].StartedAt = time.Time{} }, "started_at"},
		{"unitless metric", func(r *Report) { r.Results[0].Metrics[0].Unit = "" }, "name and a unit"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := validReport()
			tc.mutate(r)
			if _, errs := ValidateReport(mustJSON(t, r)); !hasError(errs, tc.want) {
				t.Fatalf("expected error containing %q, got: %v", tc.want, errs)
			}
		})
	}
}

func vercelReport() *Report {
	r := validReport()
	r.Provider = Provider{
		Name: "vercel", Product: "Sandbox", Plan: "2 vCPU / 4 GB", Tier: "usage-based",
		Region: "iad1", PriceEURHour: 0.299, PriceEURMonth: 218.38,
	}
	r.Measurement = Measurement{CampaignID: "vercel-sandbox-2026-07-24-v2", SampleIndex: 1, RepeatIndex: 1, FreshInstance: true}
	return r
}

// excludedPilot is an audit record without coordinates or price, kept out of
// ranked aggregates via exclude_from_aggregate as the schema describes.
func excludedPilot() *Report {
	r := vercelReport()
	r.Provider.Tier = ""
	r.Provider.PriceEURHour = 0
	r.Provider.PriceEURMonth = 0
	r.Measurement = Measurement{ExcludeFromAggregate: true}
	return r
}

func TestDatasetErrorsAcceptsRealFiles(t *testing.T) {
	cases := []struct {
		report   *Report
		filename string
	}{
		{validReport(), "hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-2-1.json"},
		{vercelReport(), "vercel-sandbox-2vcpu-iad1-vercel-sandbox-2026-07-24-v2-1-1.json"},
		{excludedPilot(), "vercel-sandbox-2vcpu.json"},
	}
	for _, tc := range cases {
		if errs := DatasetErrors(tc.report, tc.filename); len(errs) != 0 {
			t.Errorf("%s rejected: %v", tc.filename, errs)
		}
	}
}

func TestDatasetErrorsProblems(t *testing.T) {
	goodName := "hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-2-1.json"
	cases := []struct {
		name     string
		mutate   func(*Report)
		filename string
		want     string
	}{
		{"sample data", func(r *Report) { r.Sample = true }, goodName, "real measurements only"},
		{"excluded but wrong prefix", func(r *Report) { r.Measurement = Measurement{ExcludeFromAggregate: true} }, "aws-cloud-vps-cpx22.json", "must start with"},
		{"missing product", func(r *Report) { r.Provider.Product = "" }, goodName, "provider name, product"},
		{"no campaign", func(r *Report) { r.Measurement = Measurement{} }, goodName, "campaign coordinates"},
		{"no price", func(r *Report) { r.Provider.PriceEURMonth = 0 }, goodName, "price_eur_month"},
		{"empty results", func(r *Report) { r.Results = []Result{} }, goodName, "at least one result"},
		{"success without metrics", func(r *Report) { r.Results[0].Metrics = nil }, goodName, "no metrics"},
		{"uppercase name", nil, "Hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-2-1.json", "may only contain"},
		{"wrong provider prefix", nil, "aws-cloud-vps-cpx22-fsn1-hetzner-2026q3-2-1.json", "must start with"},
		{"wrong coordinates", nil, "hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-3-1.json", "must end with"},
		{"missing region", nil, "hetzner-cloud-vps-cpx22-hetzner-2026q3-2-1.json", "<plan>-<region>"},
		{"missing plan", nil, "hetzner-cloud-vps-fsn1-hetzner-2026q3-2-1.json", "<plan>-<region>"},
		{"not json", nil, "hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-2-1.txt", ".json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := validReport()
			if tc.mutate != nil {
				tc.mutate(r)
			}
			if errs := DatasetErrors(r, tc.filename); !hasError(errs, tc.want) {
				t.Fatalf("expected error containing %q, got: %v", tc.want, errs)
			}
		})
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Sandbox":        "sandbox",
		"cloud-vps":      "cloud-vps",
		"2 vCPU / 4 GB":  "2-vcpu-4-gb",
		"hetzner-2026q3": "hetzner-2026q3",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}
