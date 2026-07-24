package bench

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

// ValidTier reports whether tier is empty or one of the schema's price tiers.
func ValidTier(tier string) bool {
	switch tier {
	case "", "cheap", "medium", "dedicated", "usage-based":
		return true
	}
	return false
}

// ValidateReport parses data strictly and returns every structural problem it
// finds. It is the Go mirror of schema/result.schema.json plus the cross-field
// rules a schema cannot express (campaign coordinates travel together).
// Reports from any runner — this CLI or a future category's — must pass.
func ValidateReport(data []byte) (*Report, []error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var r Report
	if err := dec.Decode(&r); err != nil {
		return nil, []error{fmt.Errorf("parse: %w", err)}
	}
	if dec.More() {
		return nil, []error{fmt.Errorf("parse: trailing data after the report object")}
	}

	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if r.SchemaVersion != SchemaVersion {
		fail("schema_version is %d, want %d", r.SchemaVersion, SchemaVersion)
	}
	if r.CLIVersion == "" {
		fail("cli_version is missing")
	}
	if r.Category == "" {
		fail("category is missing")
	}
	if r.CreatedAt.IsZero() {
		fail("created_at is missing")
	}
	if !ValidTier(r.Provider.Tier) {
		fail("provider.tier %q is not one of: cheap, medium, dedicated, usage-based", r.Provider.Tier)
	}
	if r.Provider.PriceEURHour < 0 || r.Provider.PriceEURMonth < 0 {
		fail("provider prices must not be negative")
	}
	if r.System.OS == "" || r.System.Arch == "" {
		fail("system.os and system.arch are required")
	}
	if r.System.CPUCores < 1 {
		fail("system.cpu_cores must be >= 1")
	}
	if r.System.MemTotalMB < 0 {
		fail("system.mem_total_mb must not be negative")
	}

	m := r.Measurement
	if m.CampaignID != "" || m.SampleIndex != 0 || m.RepeatIndex != 0 {
		if m.CampaignID == "" || m.SampleIndex < 1 || m.RepeatIndex < 1 {
			fail("campaign coordinates travel together: campaign_id, sample_index (>= 1) and repeat_index (>= 1)")
		}
	}

	if r.Results == nil {
		fail("results is missing")
	}
	for i, res := range r.Results {
		name := fmt.Sprintf("results[%d]", i)
		if res.Test == "" {
			fail("%s: test name is missing", name)
		} else {
			name = fmt.Sprintf("results[%d] (%s)", i, res.Test)
		}
		if res.StartedAt.IsZero() {
			fail("%s: started_at is missing", name)
		}
		if res.DurationSeconds < 0 {
			fail("%s: duration_seconds must not be negative", name)
		}
		for j, met := range res.Metrics {
			if met.Name == "" || met.Unit == "" {
				fail("%s: metrics[%d] needs a name and a unit", name, j)
			}
		}
	}
	return &r, errs
}

// DatasetErrors checks the extra conventions for reports submitted to
// data/results/: real measurements only, complete provider identity, campaign
// coordinates, and the documented naming
// <provider>-<product>-<plan>-<region>-<campaign>-<sample>-<repeat>.json.
// filename is the report's base name; pass "" to skip the naming checks.
func DatasetErrors(r *Report, filename string) []error {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if r.Sample {
		fail("sample reports are illustrative placeholders — data/results holds real measurements only")
	}
	if r.Provider.Name == "" || r.Provider.Product == "" || r.Provider.Plan == "" || r.Provider.Region == "" {
		fail("dataset reports need provider name, product, plan and region")
	}
	// Reports marked exclude_from_aggregate are audit-trail pilots; the rules
	// below only protect ranked aggregates, so they don't apply there.
	if !r.Measurement.ExcludeFromAggregate {
		if r.Measurement.CampaignID == "" {
			fail("dataset reports need campaign coordinates (campaign_id, sample_index, repeat_index) unless exclude_from_aggregate is set")
		}
		if r.Category == "compute" && r.Provider.PriceEURMonth <= 0 {
			fail("compute reports need price_eur_month for price/performance")
		}
	}
	if len(r.Results) == 0 {
		fail("dataset reports need at least one result")
	}
	for i, res := range r.Results {
		if res.Error == "" && len(res.Metrics) == 0 {
			fail("results[%d] (%s) succeeded but recorded no metrics", i, res.Test)
		}
	}
	if filename != "" {
		errs = append(errs, filenameErrors(r, filename)...)
	}
	return errs
}

// filenameErrors verifies the mechanically derivable parts of the dataset
// naming convention. The plan segment is a human-chosen slug (e.g. "2vcpu"
// for the plan "2 vCPU / 4 GB"), so it only has to be present, not derivable.
func filenameErrors(r *Report, filename string) []error {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	for _, c := range filename {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.' || c == '_') {
			fail("file name may only contain a-z, 0-9, '-', '_' and '.'")
			break
		}
	}
	name, ok := strings.CutSuffix(filename, ".json")
	if !ok {
		fail("file name must end in .json")
		return errs
	}

	prefix := slugify(r.Provider.Name) + "-" + slugify(r.Provider.Product) + "-"
	if !strings.HasPrefix(name, prefix) {
		fail("file name must start with %q (provider-product)", prefix)
	}
	if r.Measurement.CampaignID == "" {
		return errs // audit-trail reports without coordinates have no fixed suffix
	}
	suffix := fmt.Sprintf("-%s-%d-%d", slugify(r.Measurement.CampaignID), r.Measurement.SampleIndex, r.Measurement.RepeatIndex)
	if !strings.HasSuffix(name, suffix) {
		fail("file name must end with %q (campaign-sample-repeat)", suffix+".json")
	}
	if strings.HasPrefix(name, prefix) && strings.HasSuffix(name, suffix) {
		middle := strings.TrimSuffix(strings.TrimPrefix(name, prefix), suffix)
		region := slugify(r.Provider.Region)
		plan, ok := strings.CutSuffix(middle, "-"+region)
		if !ok || plan == "" {
			fail("file name needs <plan>-<region> between product and campaign (region %q)", region)
		}
	}
	return errs
}

// slugify lowercases value and collapses characters outside [a-z0-9-._] to
// single dashes — the same rule the campaign runners use for file names.
func slugify(value string) string {
	var b strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(value) {
		allowed := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_' || r == '.' || r == '-'
		if allowed {
			b.WriteRune(r)
			lastDash = r == '-'
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-._")
}
