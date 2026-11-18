package bench

import (
	"fmt"
	"sort"
	"strings"
	"testing"
)

func fullComputeReport(sample, repeat int) *Report {
	r := validReport()
	r.Measurement.SampleIndex = sample
	r.Measurement.RepeatIndex = repeat
	byTest := make(map[string][]Metric)
	for key, definition := range computeStandardMetrics {
		test, metric, _ := strings.Cut(key, ".")
		byTest[test] = append(byTest[test], Metric{
			Name:           metric,
			Value:          float64(sample*100 + repeat),
			Unit:           definition.unit,
			HigherIsBetter: definition.higherIsBetter,
		})
	}
	r.Results = nil
	tests := make([]string, 0, len(byTest))
	for test := range byTest {
		tests = append(tests, test)
	}
	sort.Strings(tests)
	for _, test := range tests {
		metrics := byTest[test]
		sort.Slice(metrics, func(i, j int) bool { return metrics[i].Name < metrics[j].Name })
		r.Results = append(r.Results, Result{
			Test:            test,
			StartedAt:       r.CreatedAt,
			DurationSeconds: 1,
			Metrics:         metrics,
		})
	}
	return r
}

func datasetFile(t *testing.T, r *Report, planSlug string) DatasetFile {
	t.Helper()
	name := fmt.Sprintf(
		"hetzner-cloud-vps-%s-fsn1-%s-%d-%d.json",
		planSlug,
		slugify(r.Measurement.CampaignID),
		r.Measurement.SampleIndex,
		r.Measurement.RepeatIndex,
	)
	return DatasetFile{Name: name, Data: mustJSON(t, r)}
}

func completeV2Dataset(t *testing.T) []DatasetFile {
	t.Helper()
	var files []DatasetFile
	for sample := 1; sample <= 10; sample++ {
		for repeat := 1; repeat <= 3; repeat++ {
			files = append(files, datasetFile(t, fullComputeReport(sample, repeat), "cpx22"))
		}
	}
	return files
}

func TestValidateDatasetCompleteV2CohortRanks(t *testing.T) {
	manifest, errs := ValidateDataset(completeV2Dataset(t))
	if len(errs) != 0 {
		t.Fatalf("complete dataset rejected: %v", errs)
	}
	if len(manifest.Reports) != 30 {
		t.Fatalf("manifest contains %d reports, want 30", len(manifest.Reports))
	}
	for _, entry := range manifest.Reports {
		if !entry.RankEligible || len(entry.EligibilityReasons) != 0 {
			t.Fatalf("%s unexpectedly provisional: %v", entry.File, entry.EligibilityReasons)
		}
		if entry.ProtocolVersion != ComputeProtocol || entry.Profile != StandardProfile {
			t.Fatalf("%s has wrong method identity: %s/%s", entry.File, entry.ProtocolVersion, entry.Profile)
		}
	}
}

func TestValidateDatasetIncompleteV2CohortIsValidButProvisional(t *testing.T) {
	files := completeV2Dataset(t)
	manifest, errs := ValidateDataset(files[:len(files)-1])
	if len(errs) != 0 {
		t.Fatalf("incomplete but auditable dataset rejected: %v", errs)
	}
	if manifest.Reports[0].RankEligible {
		t.Fatal("incomplete cohort ranked")
	}
	if len(manifest.Reports[0].EligibilityReasons) == 0 {
		t.Fatal("incomplete cohort has no eligibility reason")
	}
}

func TestValidateDatasetRejectsDuplicateCoordinates(t *testing.T) {
	r := fullComputeReport(1, 1)
	files := []DatasetFile{
		datasetFile(t, r, "cpx22"),
		datasetFile(t, r, "cpx22-alias"),
	}
	_, errs := ValidateDataset(files)
	if !hasError(errs, "duplicate dataset coordinates") {
		t.Fatalf("duplicate coordinates accepted: %v", errs)
	}
}

func TestValidateDatasetRejectsMixedMetricDefinitions(t *testing.T) {
	files := completeV2Dataset(t)
	r := fullComputeReport(1, 1)
	r.Results[0].Metrics[0].Unit = "different"
	files[0] = datasetFile(t, r, "cpx22")
	_, errs := ValidateDataset(files)
	if !hasError(errs, "changes definition") {
		t.Fatalf("mixed metric definition accepted: %v", errs)
	}
}

func TestValidateDatasetRejectsMixedMetricDirections(t *testing.T) {
	files := completeV2Dataset(t)
	r := fullComputeReport(1, 1)
	r.Results[0].Metrics[0].HigherIsBetter = !r.Results[0].Metrics[0].HigherIsBetter
	files[0] = datasetFile(t, r, "cpx22")
	_, errs := ValidateDataset(files)
	if !hasError(errs, "changes definition") {
		t.Fatalf("mixed metric direction accepted: %v", errs)
	}
}

func TestValidateDatasetRejectsMixedPricingBasis(t *testing.T) {
	files := completeV2Dataset(t)
	r := fullComputeReport(1, 1)
	r.Environment = map[string]string{
		"pricing_as_of": "2026-07-24",
		"pricing_basis": "different",
	}
	files[0] = datasetFile(t, r, "cpx22")
	_, errs := ValidateDataset(files)
	if !hasError(errs, "mixes pricing basis") {
		t.Fatalf("mixed pricing basis accepted: %v", errs)
	}
}

func TestValidateDatasetRejectsProtocolAndProfileMixingInsideCampaign(t *testing.T) {
	t.Run("protocol", func(t *testing.T) {
		files := completeV2Dataset(t)
		r := fullComputeReport(1, 1)
		r.SchemaVersion = LegacySchemaVersion
		r.ProtocolVersion = ""
		r.Profile = ""
		files[0] = datasetFile(t, r, "cpx22")
		_, errs := ValidateDataset(files)
		if !hasError(errs, "mixes protocol versions") {
			t.Fatalf("mixed protocol accepted: %v", errs)
		}
	})
	t.Run("profile", func(t *testing.T) {
		files := completeV2Dataset(t)
		r := fullComputeReport(1, 1)
		r.Profile = SustainedProfile
		files[0] = datasetFile(t, r, "cpx22")
		_, errs := ValidateDataset(files)
		if !hasError(errs, "mixes profiles") {
			t.Fatalf("mixed profile accepted: %v", errs)
		}
	})
}

func TestValidateDatasetKeepsFailedReportButDoesNotRank(t *testing.T) {
	files := completeV2Dataset(t)
	r := fullComputeReport(1, 1)
	r.Results[0].Metrics = []Metric{}
	r.Results[0].Error = "workload failed"
	files[0] = datasetFile(t, r, "cpx22")
	manifest, errs := ValidateDataset(files)
	if len(errs) != 0 {
		t.Fatalf("valid failure report rejected: %v", errs)
	}
	if manifest.Reports[0].RankEligible {
		t.Fatal("cohort containing a workload failure ranked")
	}
	if !strings.Contains(strings.Join(manifest.Reports[0].EligibilityReasons, " "), "benchmark errors") {
		t.Fatalf("failure reason missing: %v", manifest.Reports[0].EligibilityReasons)
	}
}

func TestDatasetManifestIsDeterministic(t *testing.T) {
	files := completeV2Dataset(t)
	first, errs := ValidateDataset(files)
	if len(errs) != 0 {
		t.Fatal(errs)
	}
	for left, right := 0, len(files)-1; left < right; left, right = left+1, right-1 {
		files[left], files[right] = files[right], files[left]
	}
	second, errs := ValidateDataset(files)
	if len(errs) != 0 {
		t.Fatal(errs)
	}
	firstJSON, err := first.JSON()
	if err != nil {
		t.Fatal(err)
	}
	secondJSON, err := second.JSON()
	if err != nil {
		t.Fatal(err)
	}
	if string(firstJSON) != string(secondJSON) {
		t.Fatal("manifest output changes with input order")
	}
}
