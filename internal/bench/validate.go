package bench

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"

	reportschema "github.com/niklas-schmidt-dev/providerbench/schema"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

// ValidTier reports whether tier is empty or one of the schema's price tiers.
func ValidTier(tier string) bool {
	switch tier {
	case "", "cheap", "medium", "dedicated", "usage-based":
		return true
	}
	return false
}

var (
	schemasOnce sync.Once
	schemas     map[int]*jsonschema.Schema
	schemasErr  error
)

// ValidateReport validates a report with the public schema selected by its
// schema_version, then decodes it into the shared Go type. Version 1 keeps its
// historical strict-decoder checks; version 2 delegates structure entirely to
// the embedded Draft 2020-12 contract and keeps only semantic checks here.
func ValidateReport(data []byte) (*Report, []error) {
	version, err := schemaVersion(data)
	if err != nil {
		return nil, []error{fmt.Errorf("parse: %w", err)}
	}
	if version != LegacySchemaVersion && version != SchemaVersion {
		return nil, []error{fmt.Errorf("schema_version is %d, supported versions are %d and %d", version, LegacySchemaVersion, SchemaVersion)}
	}
	if err := validateSchema(version, data); err != nil {
		return nil, []error{fmt.Errorf("schema v%d: %w", version, err)}
	}

	dec := json.NewDecoder(bytes.NewReader(data))
	if version == LegacySchemaVersion {
		dec.DisallowUnknownFields()
	}
	var r Report
	if err := dec.Decode(&r); err != nil {
		return nil, []error{fmt.Errorf("parse: %w", err)}
	}
	if err := expectEOF(dec); err != nil {
		return nil, []error{fmt.Errorf("parse: trailing data after the report object")}
	}

	if version == SchemaVersion {
		return &r, semanticV2Errors(&r)
	}
	return &r, legacyReportErrors(&r)
}

func schemaVersion(data []byte) (int, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	var header struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := dec.Decode(&header); err != nil {
		return 0, err
	}
	if err := expectEOF(dec); err != nil {
		return 0, err
	}
	return header.SchemaVersion, nil
}

func expectEOF(dec *json.Decoder) error {
	var extra any
	err := dec.Decode(&extra)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return errorsNewTrailingData
	}
	return err
}

var errorsNewTrailingData = fmt.Errorf("trailing data after the report object")

func validateSchema(version int, data []byte) error {
	schemasOnce.Do(compileSchemas)
	if schemasErr != nil {
		return fmt.Errorf("load embedded schemas: %w", schemasErr)
	}
	instance, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		return err
	}
	return schemas[version].Validate(instance)
}

func compileSchemas() {
	schemas = make(map[int]*jsonschema.Schema, 2)
	for version, name := range map[int]string{
		LegacySchemaVersion: "result.schema.json",
		SchemaVersion:       "result-v2.schema.json",
	} {
		data, err := reportschema.Files.ReadFile(name)
		if err != nil {
			schemasErr = err
			return
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
		if err != nil {
			schemasErr = fmt.Errorf("%s: %w", name, err)
			return
		}
		compiler := jsonschema.NewCompiler()
		compiler.DefaultDraft(jsonschema.Draft2020)
		compiler.AssertFormat()
		url := "https://providerbench.dev/schema/" + name
		if err := compiler.AddResource(url, doc); err != nil {
			schemasErr = fmt.Errorf("%s: %w", name, err)
			return
		}
		compiled, err := compiler.Compile(url)
		if err != nil {
			schemasErr = fmt.Errorf("%s: %w", name, err)
			return
		}
		schemas[version] = compiled
	}
}

func semanticV2Errors(r *Report) []error {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if want, ok := ProtocolFor(r.Category); ok && r.ProtocolVersion != want {
		fail("%s reports need protocol_version %q", r.Category, want)
	}
	if r.Profile == SustainedProfile && r.Quick {
		fail("sustained reports cannot also be quick")
	}
	if r.CreatedAt.IsZero() {
		fail("created_at must not be the zero timestamp")
	}
	for i, result := range r.Results {
		if result.StartedAt.IsZero() {
			fail("results[%d] (%s): started_at must not be the zero timestamp", i, result.Test)
		}
	}
	return errs
}

func legacyReportErrors(r *Report) []error {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if r.SchemaVersion != LegacySchemaVersion {
		fail("schema_version is %d, want %d", r.SchemaVersion, LegacySchemaVersion)
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
	return errs
}

// EffectiveProtocol returns the immutable method identity used for grouping.
// Legacy reports predate the field, so their CLI version forms an explicit
// non-comparable protocol boundary.
func EffectiveProtocol(r *Report) string {
	if r.ProtocolVersion != "" {
		return r.ProtocolVersion
	}
	category := r.Category
	if category == "" {
		category = "compute"
	}
	return slugify(category + "-cli-" + r.CLIVersion)
}

// EffectiveProfile returns the report profile, defaulting legacy data to the
// standard short-running suite.
func EffectiveProfile(r *Report) string {
	if r.Profile != "" {
		return r.Profile
	}
	return StandardProfile
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
