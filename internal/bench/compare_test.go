package bench

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

// cohort builds one report per host and repeat. value(host, repeat) supplies
// the single metric each report carries.
func cohort(plan, campaign, cpu string, hosts, repeats int, value func(host, repeat int) float64) []NamedReport {
	var out []NamedReport
	for host := 1; host <= hosts; host++ {
		for repeat := 1; repeat <= repeats; repeat++ {
			r := validReport()
			r.Provider.Plan = plan
			r.System.CPUModel = cpu
			r.Measurement = Measurement{CampaignID: campaign, SampleIndex: host, RepeatIndex: repeat, FreshInstance: true}
			r.Results[0].Metrics[0].Value = value(host, repeat)
			out = append(out, NamedReport{Name: fmt.Sprintf("%s-%s-%d-%d.json", plan, campaign, host, repeat), Report: r})
		}
	}
	return out
}

func onlyMetric(t *testing.T, c *Comparison) MetricComparison {
	t.Helper()
	if len(c.Metrics) != 1 {
		t.Fatalf("want one compared metric, got %d", len(c.Metrics))
	}
	return c.Metrics[0]
}

func TestParseFilterAndMatch(t *testing.T) {
	f, err := ParseFilter(" plan = 2 vCPU / 4 GB , region=IAD1,cpu=xeon")
	if err != nil {
		t.Fatal(err)
	}
	r := validReport()
	r.Provider.Plan = "2-vcpu-4-gb"
	r.Provider.Region = "iad1"
	r.System.CPUModel = "Intel(R) Xeon(R) Processor @ 2.90GHz"
	if !f.Matches(r) {
		t.Error("identity fields must match after slugifying and the CPU as a case-insensitive substring")
	}
	r.System.CPUModel = "AMD EPYC-Genoa Processor"
	if f.Matches(r) {
		t.Error("a different CPU model matched")
	}
	if !(Filter{}).Matches(r) {
		t.Error("the empty filter must match every report")
	}
	for _, bad := range []string{"plan", "plan=", "colour=blue"} {
		if _, err := ParseFilter(bad); err == nil {
			t.Errorf("ParseFilter(%q) was accepted", bad)
		}
	}
}

func TestCompareReducesRepeatsBeforeComparingHosts(t *testing.T) {
	// Every host of A has one wild repeat. If repeats were pooled as if
	// they were hosts, A's median would move; reduced per host it is 100.
	a := cohort("a", "c1", "", 10, 3, func(host, repeat int) float64 {
		if repeat == 3 {
			return 900
		}
		return 100
	})
	b := cohort("b", "c1", "", 10, 3, func(int, int) float64 { return 150 })
	c, err := Compare(a, b, 2000, false)
	if err != nil {
		t.Fatal(err)
	}
	m := onlyMetric(t, c)
	if m.A.P50 != 100 || m.B.P50 != 150 || m.A.Hosts != 10 || c.A.Reports != 30 || c.A.Hosts != 10 {
		t.Errorf("sides summarised wrongly: A %+v B %+v summary %+v", m.A, m.B, c.A)
	}
	if m.Ratio == nil || *m.Ratio != 1.5 || m.Verdict != VerdictBBetter {
		t.Errorf("ratio %v verdict %q, want 1.5 and %q", m.Ratio, m.Verdict, VerdictBBetter)
	}
	if *m.Low != 1.5 || *m.High != 1.5 {
		t.Errorf("identical hosts must give a zero-width interval, got %v … %v", *m.Low, *m.High)
	}
}

func TestCompareVerdictFollowsTheMetricDirection(t *testing.T) {
	lower := func(reports []NamedReport) []NamedReport {
		for _, nr := range reports {
			nr.Report.Results[0].Metrics[0].HigherIsBetter = false
			nr.Report.Results[0].Metrics[0].Unit = "ms"
		}
		return reports
	}
	a := lower(cohort("a", "c1", "", 10, 1, func(host, _ int) float64 { return 10 + float64(host)/100 }))
	b := lower(cohort("b", "c1", "", 10, 1, func(host, _ int) float64 { return 20 + float64(host)/100 }))
	c, err := Compare(a, b, 2000, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := onlyMetric(t, c); m.Verdict != VerdictABetter {
		t.Errorf("B is twice as slow on a lower-is-better metric; verdict %q, want %q", m.Verdict, VerdictABetter)
	}
}

func TestCompareWithholdsAVerdictWhenHostsOverlap(t *testing.T) {
	spread := func(offset float64) func(int, int) float64 {
		return func(host, _ int) float64 { return 100 + offset + float64(host*7%10)*10 }
	}
	c, err := Compare(cohort("a", "c1", "", 10, 1, spread(0)), cohort("b", "c1", "", 10, 1, spread(2)), 4000, false)
	if err != nil {
		t.Fatal(err)
	}
	m := onlyMetric(t, c)
	if m.Verdict != VerdictNoDifference {
		t.Errorf("a 2-unit shift inside a 90-unit host spread got verdict %q", m.Verdict)
	}
	if !(*m.Low < 1 && *m.High > 1) {
		t.Errorf("interval %v … %v must straddle 1", *m.Low, *m.High)
	}
}

func TestCompareIsDeterministic(t *testing.T) {
	noisy := func(seed int) func(int, int) float64 {
		return func(host, repeat int) float64 { return 100 + float64((host*31+repeat*17+seed)%23) }
	}
	a, b := cohort("a", "c1", "", 10, 3, noisy(1)), cohort("b", "c1", "", 10, 3, noisy(5))
	first, err := Compare(a, b, 3000, false)
	if err != nil {
		t.Fatal(err)
	}
	second, _ := Compare(a, b, 3000, false)
	if !reflect.DeepEqual(first, second) {
		t.Error("the same reports produced different intervals")
	}
}

func TestCompareHandlesSmallAndZeroSides(t *testing.T) {
	a := cohort("a", "c1", "", 3, 1, func(int, int) float64 { return 100 })
	b := cohort("b", "c1", "", 10, 1, func(int, int) float64 { return 200 })
	c, err := Compare(a, b, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := onlyMetric(t, c); m.Verdict != VerdictTooFewHosts || m.Low != nil || m.Ratio == nil {
		t.Errorf("three hosts cannot carry an interval: %+v", m)
	}

	zero := cohort("a", "c1", "", 10, 1, func(int, int) float64 { return 0 })
	c, err = Compare(zero, b, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := onlyMetric(t, c); m.Verdict != VerdictZeroBaseline || m.Ratio != nil {
		t.Errorf("a zero baseline has no ratio: %+v", m)
	}
}

func TestCompareKeepsZeroBaselineDrawsInTheInterval(t *testing.T) {
	// A's median is 1, but a third of the resamples draw a median of 0.
	// Dropping those left only ratios of 0.5 and below: "A better".
	values := []float64{0, 0, 1, 2, 3}
	a := cohort("a", "c1", "", 5, 1, func(host, _ int) float64 { return values[host-1] })
	b := cohort("b", "c1", "", 5, 1, func(int, int) float64 { return 0.5 })
	c, err := Compare(a, b, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := onlyMetric(t, c); m.Verdict != VerdictUnbounded || m.Low != nil || m.High != nil {
		t.Errorf("an interval that reaches a zero baseline carries no verdict: %+v", m)
	}
}

func TestCompareCountsReportsWithoutCoordinatesAsOneHost(t *testing.T) {
	adHoc := func(plan string, value float64) []NamedReport {
		reports := cohort(plan, "", "", 6, 1, func(int, int) float64 { return value })
		for i, nr := range reports {
			nr.Report.Measurement = Measurement{}
			nr.Report.Provider.Region = fmt.Sprintf("region-%d", i)
		}
		return reports
	}
	c, err := Compare(adHoc("a", 100), adHoc("b", 200), 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if c.A.Hosts != 1 || c.B.Hosts != 1 {
		t.Errorf("six runs of unknown origin are not six hosts: A %d, B %d", c.A.Hosts, c.B.Hosts)
	}
	if m := onlyMetric(t, c); m.Verdict != VerdictTooFewHosts || m.Low != nil {
		t.Errorf("unknown hosts cannot carry an interval: %+v", m)
	}
}

func TestCompareSkipsReportsThatAreNotEvidence(t *testing.T) {
	a := cohort("a", "c1", "", 10, 1, func(int, int) float64 { return 100 })
	b := cohort("b", "c1", "", 10, 1, func(int, int) float64 { return 100 })
	quick := cohort("a", "c1", "", 1, 1, func(int, int) float64 { return 5000 })[0]
	quick.Report.Quick = true
	quick.Report.Measurement.SampleIndex = 11
	pilot := cohort("a", "c1", "", 1, 1, func(int, int) float64 { return 5000 })[0]
	pilot.Report.Measurement.ExcludeFromAggregate = true
	pilot.Report.Measurement.SampleIndex = 12
	failed := cohort("a", "c1", "", 1, 1, func(int, int) float64 { return 5000 })[0]
	failed.Report.Measurement.SampleIndex = 1
	failed.Report.Measurement.RepeatIndex = 2
	failed.Report.Results[0].Error = "disk full"
	failed.Report.Results[0].Metrics = nil

	c, err := Compare(append(a, quick, pilot, failed), b, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if m := onlyMetric(t, c); m.A.P50 != 100 || m.A.Hosts != 10 {
		t.Errorf("quick, pilot or failed results leaked into the comparison: %+v", m.A)
	}
}

func TestCompareGuardsProtocolAndSuiteBoundaries(t *testing.T) {
	a := cohort("a", "c1", "", 10, 1, func(int, int) float64 { return 100 })
	b := cohort("b", "c1", "", 10, 1, func(int, int) float64 { return 110 })
	for _, nr := range b {
		nr.Report.SchemaVersion = LegacySchemaVersion
		nr.Report.ProtocolVersion = ""
		nr.Report.CLIVersion = "0.1.0-dev"
	}
	if _, err := Compare(a, b, 1000, false); err == nil || !strings.Contains(err.Error(), "--across-protocols") {
		t.Errorf("different protocols must be refused by default, got %v", err)
	}
	c, err := Compare(a, b, 1000, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Protocols) != 2 {
		t.Errorf("both protocols must be reported, got %v", c.Protocols)
	}

	other := cohort("b", "c1", "", 10, 1, func(int, int) float64 { return 110 })
	for _, nr := range other {
		nr.Report.Category = "workload"
		nr.Report.ProtocolVersion = WorkloadProtocol
	}
	if _, err := Compare(a, other, 1000, true); err == nil {
		t.Error("different suites must never be compared")
	}
	if _, err := Compare(a, nil, 1000, false); err == nil {
		t.Error("an empty selection must be an error")
	}
	if _, err := Compare(a, b, 10, true); err == nil {
		t.Error("too few resamples must be rejected")
	}
}

func TestCompareTreatsCampaignsAsSeparateHosts(t *testing.T) {
	// Sample 1 of two campaigns is two machines, not one.
	a := append(
		cohort("a", "c1", "", 5, 1, func(int, int) float64 { return 100 }),
		cohort("a", "c2", "", 5, 1, func(int, int) float64 { return 100 })...,
	)
	b := cohort("b", "c1", "", 10, 1, func(int, int) float64 { return 100 })
	c, err := Compare(a, b, 1000, false)
	if err != nil {
		t.Fatal(err)
	}
	if c.A.Hosts != 10 || len(c.A.Cohorts) != 2 {
		t.Errorf("A has %d hosts in %d cohorts, want 10 in 2", c.A.Hosts, len(c.A.Cohorts))
	}
}

func TestQuantileMatchesTheSiteAggregator(t *testing.T) {
	values := []float64{4, 1, 3, 2}
	for q, want := range map[float64]float64{0: 1, 0.5: 2.5, 1: 4, 0.1: 1.3} {
		if got := quantile(values, q); math.Abs(got-want) > 1e-9 {
			t.Errorf("quantile(%v) = %v, want %v", q, got, want)
		}
	}
	if values[0] != 4 {
		t.Error("quantile reordered its input")
	}
}
