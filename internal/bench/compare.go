package bench

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
)

// Filter selects reports for one side of a comparison. Empty fields match
// everything. Identity fields compare after slugifying, so "2 vCPU / 4 GB"
// matches "2-vcpu-4-gb"; CPU is a case-insensitive substring of the reported
// CPU model, which is how one plan's hardware generations are told apart.
type Filter struct {
	Provider string
	Product  string
	Plan     string
	Region   string
	Campaign string
	CPU      string
}

// ParseFilter reads a comma-separated key=value list such as
// "plan=cpx22,region=fsn1".
func ParseFilter(spec string) (Filter, error) {
	var f Filter
	for part := range strings.SplitSeq(spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		key, value, ok := strings.Cut(part, "=")
		value = strings.TrimSpace(value)
		if !ok || value == "" {
			return Filter{}, fmt.Errorf("filter %q: expected key=value", part)
		}
		switch strings.TrimSpace(key) {
		case "provider":
			f.Provider = value
		case "product":
			f.Product = value
		case "plan":
			f.Plan = value
		case "region":
			f.Region = value
		case "campaign":
			f.Campaign = value
		case "cpu":
			f.CPU = value
		default:
			return Filter{}, fmt.Errorf("filter %q: unknown key (use provider, product, plan, region, campaign, cpu)", part)
		}
	}
	return f, nil
}

// Matches reports whether r belongs to the selection.
func (f Filter) Matches(r *Report) bool {
	same := func(want, got string) bool {
		return want == "" || slugify(want) == slugify(got)
	}
	return same(f.Provider, r.Provider.Name) &&
		same(f.Product, r.Provider.Product) &&
		same(f.Plan, r.Provider.Plan) &&
		same(f.Region, r.Provider.Region) &&
		same(f.Campaign, r.Measurement.CampaignID) &&
		(f.CPU == "" || strings.Contains(strings.ToLower(r.System.CPUModel), strings.ToLower(f.CPU)))
}

// NamedReport is a report together with the name it was loaded from.
type NamedReport struct {
	Name   string
	Report *Report
}

// SideSummary describes what one side of a comparison was built from.
type SideSummary struct {
	Hosts     int      `json:"hosts"`
	Reports   int      `json:"reports"`
	Cohorts   []string `json:"cohorts"`
	CPUModels []string `json:"cpu_models,omitempty"`
}

// MetricStats is one side's cross-host distribution for one metric.
type MetricStats struct {
	Hosts int     `json:"hosts"`
	P10   float64 `json:"p10"`
	P50   float64 `json:"p50"`
	P90   float64 `json:"p90"`
}

// Verdicts a metric comparison can reach.
const (
	VerdictBBetter      = "B better"
	VerdictABetter      = "A better"
	VerdictNoDifference = "no clear difference"
	VerdictTooFewHosts  = "too few hosts"
	VerdictZeroBaseline = "baseline is zero"
	VerdictUnbounded    = "baseline reaches zero"
)

// minHostsForInterval is the smallest side a bootstrap interval is computed
// for. Below it a resample cannot represent the spread between hosts.
const minHostsForInterval = 5

// MetricComparison compares one metric across the two sides. Ratio is B's
// median over A's; Low and High bound it with a 95% bootstrap interval.
type MetricComparison struct {
	Test           string      `json:"test"`
	Metric         string      `json:"metric"`
	Unit           string      `json:"unit"`
	HigherIsBetter bool        `json:"higher_is_better"`
	A              MetricStats `json:"a"`
	B              MetricStats `json:"b"`
	Ratio          *float64    `json:"ratio,omitempty"`
	Low            *float64    `json:"ratio_low,omitempty"`
	High           *float64    `json:"ratio_high,omitempty"`
	Verdict        string      `json:"verdict"`
}

// Comparison is the result of comparing two report selections.
type Comparison struct {
	Category  string             `json:"category"`
	Protocols []string           `json:"protocols"`
	Profile   string             `json:"profile"`
	Resamples int                `json:"resamples"`
	A         SideSummary        `json:"a"`
	B         SideSummary        `json:"b"`
	Metrics   []MetricComparison `json:"metrics"`
}

type comparisonSide struct {
	summary SideSummary
	// values holds one number per host for every metric: the median of that
	// host's repeats, exactly as the site's aggregator reduces them.
	values      map[string][]float64
	definitions map[string]metricDefinition
}

// Compare contrasts two selections of reports metric by metric.
//
// Repeats on one host are technical repeats, so each host first collapses to
// the median of its repeats; statistics then run across hosts. Quick, sample,
// failed and pilot reports never count. The interval is a percentile
// bootstrap over hosts with a fixed seed, so the same reports always print
// the same numbers.
func Compare(a, b []NamedReport, resamples int, acrossProtocols bool) (*Comparison, error) {
	if resamples < 100 {
		return nil, errors.New("at least 100 bootstrap resamples are needed")
	}
	sideA, err := buildSide(a)
	if err != nil {
		return nil, fmt.Errorf("selection A: %w", err)
	}
	sideB, err := buildSide(b)
	if err != nil {
		return nil, fmt.Errorf("selection B: %w", err)
	}

	identity := func(reports []NamedReport) (category, profile string, protocols map[string]bool, err error) {
		protocols = make(map[string]bool)
		for _, nr := range reports {
			if !countsAsEvidence(nr.Report) {
				continue
			}
			c, p := reportCategory(nr.Report), EffectiveProfile(nr.Report)
			if category == "" {
				category, profile = c, p
			}
			if c != category || p != profile {
				return "", "", nil, fmt.Errorf("mixes %s/%s with %s/%s reports", category, profile, c, p)
			}
			protocols[EffectiveProtocol(nr.Report)] = true
		}
		return category, profile, protocols, nil
	}
	categoryA, profileA, protocolsA, err := identity(a)
	if err != nil {
		return nil, fmt.Errorf("selection A %w", err)
	}
	categoryB, profileB, protocolsB, err := identity(b)
	if err != nil {
		return nil, fmt.Errorf("selection B %w", err)
	}
	if categoryA != categoryB || profileA != profileB {
		return nil, fmt.Errorf("selections are different suites: A is %s/%s, B is %s/%s", categoryA, profileA, categoryB, profileB)
	}
	protocols := make(map[string]bool)
	for p := range protocolsA {
		protocols[p] = true
	}
	for p := range protocolsB {
		protocols[p] = true
	}
	if len(protocols) > 1 && !acrossProtocols {
		return nil, fmt.Errorf(
			"selections span protocols %s — a protocol is the boundary of comparability; pass --across-protocols to compare anyway",
			strings.Join(sortedKeys(protocols), ", "),
		)
	}

	out := &Comparison{
		Category:  categoryA,
		Protocols: sortedKeys(protocols),
		Profile:   profileA,
		Resamples: resamples,
		A:         sideA.summary,
		B:         sideB.summary,
	}
	keys := make([]string, 0, len(sideA.values))
	for key := range sideA.values {
		if _, ok := sideB.values[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return nil, errors.New("the selections share no metric")
	}
	// One generator for the whole comparison: the output depends only on the
	// reports and the resample count.
	rng := rand.New(rand.NewSource(1))
	for _, key := range keys {
		definition := sideA.definitions[key]
		if other := sideB.definitions[key]; other != definition {
			return nil, fmt.Errorf("%s is defined differently on the two sides (%s vs %s)", key, definition.unit, other.unit)
		}
		test, metric, _ := strings.Cut(key, ".")
		out.Metrics = append(out.Metrics, compareMetric(
			rng, test, metric, definition, sideA.values[key], sideB.values[key], resamples,
		))
	}
	return out, nil
}

// countsAsEvidence reports whether a report may enter a comparison.
func countsAsEvidence(r *Report) bool {
	return !r.Sample && !r.Quick && !r.Measurement.ExcludeFromAggregate
}

func buildSide(reports []NamedReport) (*comparisonSide, error) {
	side := &comparisonSide{
		values:      make(map[string][]float64),
		definitions: make(map[string]metricDefinition),
	}
	type host struct {
		repeats map[string][]float64
	}
	hosts := make(map[string]*host)
	var hostOrder []string
	cohorts := make(map[string]bool)
	models := make(map[string]bool)
	for _, nr := range reports {
		r := nr.Report
		if !countsAsEvidence(r) {
			continue
		}
		side.summary.Reports++
		// Without campaign coordinates nothing says which reports share a
		// machine, so together they count as one host: a ratio, never an
		// interval.
		key := ""
		if r.Measurement.CampaignID != "" {
			key = cohortKey(r) + "\x1f" + strconv.Itoa(r.Measurement.SampleIndex)
		}
		h, ok := hosts[key]
		if !ok {
			h = &host{repeats: make(map[string][]float64)}
			hosts[key] = h
			hostOrder = append(hostOrder, key)
		}
		label := strings.Join([]string{r.Provider.Name, r.Provider.Product, r.Provider.Plan, r.Provider.Region}, " ")
		if r.Measurement.CampaignID != "" {
			label += " · " + r.Measurement.CampaignID
		}
		cohorts[label] = true
		if r.System.CPUModel != "" {
			models[r.System.CPUModel] = true
		}
		for _, result := range r.Results {
			if result.Error != "" {
				continue
			}
			for _, m := range result.Metrics {
				metricKey := result.Test + "." + m.Name
				definition := metricDefinition{unit: m.Unit, higherIsBetter: m.HigherIsBetter}
				if known, ok := side.definitions[metricKey]; ok && known != definition {
					return nil, fmt.Errorf("%s changes unit or direction inside the selection (%s)", metricKey, nr.Name)
				}
				side.definitions[metricKey] = definition
				h.repeats[metricKey] = append(h.repeats[metricKey], m.Value)
			}
		}
	}
	if len(hosts) == 0 {
		return nil, errors.New("no comparable report matches (quick, sample and pilot reports are skipped)")
	}
	// Host order follows the input order, which callers sort by file name,
	// so bootstrap resamples index the same hosts on every run.
	for _, key := range hostOrder {
		for metricKey, repeats := range hosts[key].repeats {
			side.values[metricKey] = append(side.values[metricKey], quantile(repeats, 0.5))
		}
	}
	side.summary.Hosts = len(hosts)
	side.summary.Cohorts = sortedKeys(cohorts)
	side.summary.CPUModels = sortedKeys(models)
	return side, nil
}

func compareMetric(
	rng *rand.Rand,
	test, metric string,
	definition metricDefinition,
	a, b []float64,
	resamples int,
) MetricComparison {
	out := MetricComparison{
		Test:           test,
		Metric:         metric,
		Unit:           definition.unit,
		HigherIsBetter: definition.higherIsBetter,
		A:              MetricStats{Hosts: len(a), P10: quantile(a, 0.1), P50: quantile(a, 0.5), P90: quantile(a, 0.9)},
		B:              MetricStats{Hosts: len(b), P10: quantile(b, 0.1), P50: quantile(b, 0.5), P90: quantile(b, 0.9)},
	}
	if out.A.P50 <= 0 {
		// Steal on a platform that reports none, for example: there is no
		// ratio to form, only the two medians to show.
		out.Verdict = VerdictZeroBaseline
		return out
	}
	ratio := out.B.P50 / out.A.P50
	out.Ratio = &ratio
	if len(a) < minHostsForInterval || len(b) < minHostsForInterval {
		out.Verdict = VerdictTooFewHosts
		return out
	}

	ratios := make([]float64, resamples)
	drawA := make([]float64, len(a))
	drawB := make([]float64, len(b))
	for i := range ratios {
		for j := range drawA {
			drawA[j] = a[rng.Intn(len(a))]
		}
		for j := range drawB {
			drawB[j] = b[rng.Intn(len(b))]
		}
		// A draw with a zero baseline has no finite ratio. It stays in as
		// unbounded: dropping it would pull the interval towards A.
		ratios[i] = math.Inf(1)
		if base := quantile(drawA, 0.5); base > 0 {
			ratios[i] = quantile(drawB, 0.5) / base
		}
	}
	low, high := quantile(ratios, 0.025), quantile(ratios, 0.975)
	if math.IsInf(high, 1) {
		out.Verdict = VerdictUnbounded
		return out
	}
	out.Low, out.High = &low, &high
	switch {
	case low > 1:
		out.Verdict = VerdictBBetter
		if !definition.higherIsBetter {
			out.Verdict = VerdictABetter
		}
	case high < 1:
		out.Verdict = VerdictABetter
		if !definition.higherIsBetter {
			out.Verdict = VerdictBBetter
		}
	default:
		out.Verdict = VerdictNoDifference
	}
	return out
}

// quantile interpolates linearly between the two nearest ranks, the same
// rule the site's aggregator applies. It does not reorder its input.
func quantile(values []float64, q float64) float64 {
	if len(values) == 0 {
		return math.NaN()
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	position := float64(len(sorted)-1) * q
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	fraction := position - float64(lower)
	return sorted[lower]*(1-fraction) + sorted[upper]*fraction
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
