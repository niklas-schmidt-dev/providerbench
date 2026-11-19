package bench

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const ManifestVersion = 1

// DatasetFile is one candidate report and its dataset-relative base name.
type DatasetFile struct {
	Name string
	Data []byte
}

// ManifestEntry is the validator-owned metadata consumed by the website.
type ManifestEntry struct {
	File               string   `json:"file"`
	SHA256             string   `json:"sha256"`
	SchemaVersion      int      `json:"schema_version"`
	ProtocolVersion    string   `json:"protocol_version"`
	Profile            string   `json:"profile"`
	Category           string   `json:"category"`
	CohortID           string   `json:"cohort_id"`
	RankEligible       bool     `json:"rank_eligible"`
	EligibilityReasons []string `json:"eligibility_reasons,omitempty"`
}

// DatasetManifest is deterministic: it contains no generation timestamp and
// entries and reasons are sorted. CI can therefore compare it byte-for-byte.
type DatasetManifest struct {
	ManifestVersion int             `json:"manifest_version"`
	Reports         []ManifestEntry `json:"reports"`
}

func (m *DatasetManifest) JSON() ([]byte, error) {
	out, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}

type datasetRecord struct {
	file   DatasetFile
	report *Report
	entry  ManifestEntry
}

// ValidateDataset validates individual reports and the cross-file invariants
// required for reproducible cohorts. A manifest is returned even when semantic
// cohort problems exist so callers can display all findings, but it must only
// be published when errs is empty.
func ValidateDataset(files []DatasetFile) (*DatasetManifest, []error) {
	sorted := append([]DatasetFile(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	var errs []error
	records := make([]*datasetRecord, 0, len(sorted))
	for _, file := range sorted {
		report, reportErrs := ValidateReport(file.Data)
		if report != nil {
			reportErrs = append(reportErrs, DatasetErrors(report, file.Name)...)
		}
		if len(reportErrs) > 0 {
			for _, err := range reportErrs {
				errs = append(errs, fmt.Errorf("%s: %w", file.Name, err))
			}
			continue
		}
		sum := sha256.Sum256(file.Data)
		records = append(records, &datasetRecord{
			file:   file,
			report: report,
			entry: ManifestEntry{
				File:            file.Name,
				SHA256:          hex.EncodeToString(sum[:]),
				SchemaVersion:   report.SchemaVersion,
				ProtocolVersion: EffectiveProtocol(report),
				Profile:         EffectiveProfile(report),
				Category:        reportCategory(report),
				CohortID:        report.Measurement.CampaignID,
			},
		})
	}

	errs = append(errs, datasetCoordinateErrors(records)...)
	cohorts := make(map[string][]*datasetRecord)
	for _, record := range records {
		key := cohortKey(record.report)
		cohorts[key] = append(cohorts[key], record)
	}
	cohortKeys := make([]string, 0, len(cohorts))
	for key := range cohorts {
		cohortKeys = append(cohortKeys, key)
	}
	sort.Strings(cohortKeys)
	for _, key := range cohortKeys {
		cohort := cohorts[key]
		errs = append(errs, cohortConsistencyErrors(key, cohort)...)
		reasons := cohortEligibilityReasons(cohort)
		for _, record := range cohort {
			record.entry.RankEligible = len(reasons) == 0
			record.entry.EligibilityReasons = append([]string(nil), reasons...)
		}
	}

	manifest := &DatasetManifest{ManifestVersion: ManifestVersion}
	for _, record := range records {
		manifest.Reports = append(manifest.Reports, record.entry)
	}
	return manifest, errs
}

func reportCategory(r *Report) string {
	if r.Category == "" {
		return "compute"
	}
	return r.Category
}

func baseSeriesKey(r *Report) string {
	return strings.Join([]string{
		reportCategory(r),
		r.Provider.Name,
		r.Provider.Product,
		r.Provider.Plan,
		r.Provider.Region,
	}, "\x1f")
}

func cohortKey(r *Report) string {
	return baseSeriesKey(r) + "\x1f" + r.Measurement.CampaignID
}

func coordinateKey(r *Report) string {
	return strings.Join([]string{
		cohortKey(r),
		strconv.Itoa(r.Measurement.SampleIndex),
		strconv.Itoa(r.Measurement.RepeatIndex),
	}, "\x1f")
}

func datasetCoordinateErrors(records []*datasetRecord) []error {
	seen := make(map[string]string)
	var errs []error
	for _, record := range records {
		if record.report.Measurement.CampaignID == "" {
			continue
		}
		key := coordinateKey(record.report)
		if previous, ok := seen[key]; ok {
			errs = append(errs, fmt.Errorf(
				"duplicate dataset coordinates: %s and %s describe the same provider/plan/region/campaign/sample/repeat",
				previous,
				record.file.Name,
			))
			continue
		}
		seen[key] = record.file.Name
	}
	return errs
}

type metricDefinition struct {
	unit           string
	higherIsBetter bool
}

func cohortConsistencyErrors(key string, records []*datasetRecord) []error {
	if len(records) == 0 {
		return nil
	}
	first := records[0]
	protocol := first.entry.ProtocolVersion
	profile := first.entry.Profile
	priceHour := first.report.Provider.PriceEURHour
	priceMonth := first.report.Provider.PriceEURMonth
	pricingAsOf := first.report.Environment["pricing_as_of"]
	pricingBasis := first.report.Environment["pricing_basis"]
	goVersion := first.report.Environment[GoVersionKey]
	definitions := make(map[string]metricDefinition)
	var errs []error

	for _, record := range records {
		if record.entry.ProtocolVersion != protocol {
			errs = append(errs, fmt.Errorf(
				"cohort %q mixes protocol versions %q and %q (%s)",
				key, protocol, record.entry.ProtocolVersion, record.file.Name,
			))
		}
		if record.entry.Profile != profile {
			errs = append(errs, fmt.Errorf(
				"cohort %q mixes profiles %q and %q (%s)",
				key, profile, record.entry.Profile, record.file.Name,
			))
		}
		if record.report.Provider.PriceEURHour != priceHour ||
			record.report.Provider.PriceEURMonth != priceMonth {
			errs = append(errs, fmt.Errorf("cohort %q mixes provider prices (%s)", key, record.file.Name))
		}
		if record.report.Environment["pricing_as_of"] != pricingAsOf ||
			record.report.Environment["pricing_basis"] != pricingBasis {
			errs = append(errs, fmt.Errorf("cohort %q mixes pricing basis or observation date (%s)", key, record.file.Name))
		}
		// The benchmarks are compiled code: two toolchains are two methods.
		if record.report.Environment[GoVersionKey] != goVersion {
			errs = append(errs, fmt.Errorf(
				"cohort %q mixes Go toolchains %q and %q (%s)",
				key, goVersion, record.report.Environment[GoVersionKey], record.file.Name,
			))
		}

		reportDefinitions := make(map[string]metricDefinition)
		for _, result := range record.report.Results {
			for _, metric := range result.Metrics {
				metricKey := result.Test + "." + metric.Name
				definition := metricDefinition{unit: metric.Unit, higherIsBetter: metric.HigherIsBetter}
				if _, exists := reportDefinitions[metricKey]; exists {
					errs = append(errs, fmt.Errorf("%s repeats metric %s", record.file.Name, metricKey))
					continue
				}
				reportDefinitions[metricKey] = definition
				if expected, exists := definitions[metricKey]; exists && expected != definition {
					errs = append(errs, fmt.Errorf(
						"cohort %q changes definition for %s in %s",
						key, metricKey, record.file.Name,
					))
				} else {
					definitions[metricKey] = definition
				}
			}
		}
	}
	return errs
}

var computeStandardMetrics = map[string]metricDefinition{
	"cpu.single_core_hash":         {unit: "MB/s", higherIsBetter: true},
	"cpu.multi_core_hash":          {unit: "MB/s", higherIsBetter: true},
	"cpu.scaling_efficiency":       {unit: "%", higherIsBetter: true},
	"memory.copy_bandwidth":        {unit: "GB/s", higherIsBetter: true},
	"memory.random_access_latency": {unit: "ns", higherIsBetter: false},
	"disk.seq_write":               {unit: "MB/s", higherIsBetter: true},
	"disk.seq_read":                {unit: "MB/s", higherIsBetter: true},
	"disk.rand_read_4k":            {unit: "IOPS", higherIsBetter: true},
	"disk.fsync_latency_p50":       {unit: "ms", higherIsBetter: false},
	"network.latency_p50":          {unit: "ms", higherIsBetter: false},
	"network.download":             {unit: "Mbps", higherIsBetter: true},
	"network.upload":               {unit: "Mbps", higherIsBetter: true},
	"steal.unit_time_p50":          {unit: "ms", higherIsBetter: false},
	"steal.consistency_cv":         {unit: "%", higherIsBetter: false},
	"steal.p99_over_p50":           {unit: "ratio", higherIsBetter: false},
	"steal.cpu_steal":              {unit: "%", higherIsBetter: false},
}

var legacyScoreMetrics = map[string]struct{}{
	"cpu.single_core_hash":         {},
	"cpu.multi_core_hash":          {},
	"memory.copy_bandwidth":        {},
	"memory.random_access_latency": {},
	"disk.seq_write":               {},
	"disk.seq_read":                {},
	"disk.rand_read_4k":            {},
	"disk.fsync_latency_p50":       {},
	"network.latency_p50":          {},
	"network.download":             {},
	"network.upload":               {},
	"steal.consistency_cv":         {},
	"steal.p99_over_p50":           {},
}

func cohortEligibilityReasons(records []*datasetRecord) []string {
	reasons := make(map[string]struct{})
	add := func(reason string) { reasons[reason] = struct{}{} }
	if len(records) == 0 {
		add("cohort has no reports")
		return sortedReasons(reasons)
	}

	first := records[0]
	if first.entry.Category != "compute" {
		add("ranking policy is not defined for this category")
		return sortedReasons(reasons)
	}
	if first.entry.Profile != StandardProfile {
		add("only the standard profile enters the composite ranking")
	}

	hosts := make(map[int][]*datasetRecord)
	for _, record := range records {
		r := record.report
		if r.Sample {
			add("sample reports never rank")
		}
		if r.Quick {
			add("quick reports never rank")
		}
		if r.Measurement.ExcludeFromAggregate {
			add("cohort is explicitly excluded from aggregation")
		}
		if !r.Measurement.FreshInstance {
			add("every ranked sample must be a fresh instance")
		}
		for _, result := range r.Results {
			if result.Error != "" {
				add("cohort contains benchmark errors")
			}
		}
		hosts[r.Measurement.SampleIndex] = append(hosts[r.Measurement.SampleIndex], record)
	}

	if first.report.SchemaVersion == SchemaVersion {
		v2EligibilityReasons(records, hosts, add)
	} else {
		legacyEligibilityReasons(hosts, add)
	}
	return sortedReasons(reasons)
}

func v2EligibilityReasons(records []*datasetRecord, hosts map[int][]*datasetRecord, add func(string)) {
	if len(records) != 30 || len(hosts) != 10 {
		add("compute-v2 standard ranking requires exactly 10 samples and 30 reports")
	}
	for sample := 1; sample <= 10; sample++ {
		hostRecords := hosts[sample]
		if len(hostRecords) != 3 {
			add("each compute-v2 sample needs exactly repeats 1, 2 and 3")
			continue
		}
		repeats := make(map[int]bool)
		for _, record := range hostRecords {
			repeats[record.report.Measurement.RepeatIndex] = true
			if !hasExactMetricDefinitions(record.report, computeStandardMetrics) {
				add("every compute-v2 report needs the complete 16-metric standard suite")
			}
		}
		if !repeats[1] || !repeats[2] || !repeats[3] {
			add("each compute-v2 sample needs exactly repeats 1, 2 and 3")
		}
	}
}

func legacyEligibilityReasons(hosts map[int][]*datasetRecord, add func(string)) {
	if len(hosts) < 10 {
		add("legacy ranking requires at least 10 independent samples")
	}
	for _, hostRecords := range hosts {
		hostMetrics := make(map[string]struct{})
		for _, record := range hostRecords {
			for _, result := range record.report.Results {
				for _, metric := range result.Metrics {
					hostMetrics[result.Test+"."+metric.Name] = struct{}{}
				}
			}
		}
		for metric := range legacyScoreMetrics {
			if _, ok := hostMetrics[metric]; !ok {
				add("legacy cohort lacks full score coverage on every host")
				return
			}
		}
	}
}

func hasExactMetricDefinitions(r *Report, expected map[string]metricDefinition) bool {
	actual := make(map[string]metricDefinition)
	for _, result := range r.Results {
		if result.Error != "" {
			return false
		}
		for _, metric := range result.Metrics {
			key := result.Test + "." + metric.Name
			if _, exists := actual[key]; exists {
				return false
			}
			actual[key] = metricDefinition{unit: metric.Unit, higherIsBetter: metric.HigherIsBetter}
		}
	}
	if len(actual) != len(expected) {
		return false
	}
	for key, definition := range expected {
		if actual[key] != definition {
			return false
		}
	}
	return true
}

func sortedReasons(reasons map[string]struct{}) []string {
	out := make([]string, 0, len(reasons))
	for reason := range reasons {
		out = append(out, reason)
	}
	sort.Strings(out)
	return out
}
