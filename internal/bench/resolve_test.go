package bench

import (
	"strings"
	"testing"
)

func TestResolveSuite(t *testing.T) {
	saved := registry
	t.Cleanup(func() { registry = saved })
	registry = nil
	Register(suiteProbe{name: "cpu"})
	Register(suiteProbe{name: "disk"})
	Register(profiledProbe{categorizedProbe{suiteProbe{name: "cpu-sustained", category: "compute", profile: SustainedProfile}}})
	Register(categorizedProbe{suiteProbe{name: "json", category: "workload"}})
	Register(categorizedProbe{suiteProbe{name: "mystery", category: "unpinned"}})

	names := func(s SuiteSelection) string {
		out := make([]string, len(s.Tests))
		for i, b := range s.Tests {
			out[i] = b.Name()
		}
		return strings.Join(out, ",")
	}
	for _, tc := range []struct {
		label, category, profile, tests string
		quick                           bool
		want                            string // "category/profile/protocol:tests"
		wantErr                         string
	}{
		{label: "nothing means the standard compute run", want: "compute/standard/compute-v2:cpu,disk"},
		{label: "a category selects its suite", category: "workload", want: "workload/standard/workload-v1:json"},
		{label: "a profile selects the long suite", profile: SustainedProfile, want: "compute/sustained/compute-v2:cpu-sustained"},
		{label: "named tests pin the category", tests: "json", want: "workload/standard/workload-v1:json"},
		{label: "named tests pin the profile", tests: "cpu-sustained", want: "compute/sustained/compute-v2:cpu-sustained"},
		{label: "named tests keep their order", tests: "disk,cpu", want: "compute/standard/compute-v2:disk,cpu"},
		{label: "categories never mix", tests: "cpu,json", wantErr: "a report holds one category"},
		{label: "profiles never mix", tests: "cpu,cpu-sustained", wantErr: "a report holds one profile"},
		{label: "a named test must match --category", category: "workload", tests: "cpu", wantErr: "belongs to category"},
		{label: "a named test must match --profile", profile: SustainedProfile, tests: "cpu", wantErr: "belongs to profile"},
		{label: "sustained is never quick", profile: SustainedProfile, quick: true, wantErr: "--quick does not apply"},
		{label: "unknown profile", profile: "eternal", wantErr: "--profile must be one of"},
		{label: "unknown test", tests: "nope", wantErr: "unknown test"},
		{label: "empty suite", category: "workload", profile: SustainedProfile, wantErr: "no sustained-profile tests"},
		{label: "a category needs a pinned protocol", category: "unpinned", wantErr: "no pinned protocol"},
	} {
		got, err := ResolveSuite(tc.category, tc.profile, tc.tests, tc.quick)
		if tc.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("%s: err = %v, want it to mention %q", tc.label, err, tc.wantErr)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", tc.label, err)
			continue
		}
		if have := got.Category + "/" + got.Profile + "/" + got.Protocol + ":" + names(got); have != tc.want {
			t.Errorf("%s: resolved %s, want %s", tc.label, have, tc.want)
		}
	}
}
