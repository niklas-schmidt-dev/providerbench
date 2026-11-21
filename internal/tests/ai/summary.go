package ai

import (
	"fmt"
	"io"
	"slices"
	"strings"
	"text/tabwriter"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// Summary reads one ai-language report across its tests: how much of everything the
// model solved in each language, and how far each language is from English.
type Summary struct {
	Problems int `json:"problems"` // per language
	// Tests are the tests the summary counts, and Missing the tests of the
	// suite it does not: they were not run, or they failed.
	Tests     []string          `json:"tests"`
	Missing   []string          `json:"missing,omitempty"`
	Languages []LanguageSummary `json:"languages"`
}

// Coverage says in a few words which tests a summary lacks, and nothing when
// it counts them all. Two summaries with different coverage are not about
// the same problems.
func (s *Summary) Coverage() string {
	switch {
	case len(s.Missing) == 0:
		return ""
	case len(s.Tests) < len(s.Missing):
		return "only " + strings.Join(s.Tests, ", ")
	}
	return "without " + strings.Join(s.Missing, ", ")
}

// LanguageSummary is one language of a report. The difference to English is
// in percentage points and comes with a 95% interval; the first language is
// the baseline and has none.
type LanguageSummary struct {
	Code       string  `json:"code"`
	Name       string  `json:"name"`
	Accuracy   float64 `json:"accuracy"`
	Baseline   bool    `json:"baseline,omitempty"`
	Difference float64 `json:"difference"`
	Low        float64 `json:"low"`
	High       float64 `json:"high"`
	Verdict    string  `json:"verdict,omitempty"`
}

const (
	VerdictBelow = "below English"
	VerdictAbove = "above English"
	VerdictNone  = "no clear difference"

	summaryResamples = 10000
)

// Summarize builds the summary from the outcome strings of a report. It
// returns false for a report of another category or one without outcomes.
//
// The interval is a paired bootstrap over problems. The same problem is
// asked in both languages, so each resample draws problems and keeps both
// answers of a problem together; that removes the spread between easy and
// hard problems and leaves the effect of the language. Problems are drawn
// within their test, because the number of problems per test is fixed by the
// protocol, not sampled.
func Summarize(r *bench.Report) (*Summary, bool) {
	if r.Category != Category {
		return nil, false
	}
	// solved[language][test] is one flag per problem.
	solved := make([][][]bool, len(languages))
	summary := &Summary{}
	for _, result := range r.Results {
		var perLanguage [][]bool
		for _, l := range languages {
			outcomes, ok := result.Outcomes[l.code]
			if !ok || len(outcomes) == 0 {
				perLanguage = nil
				break
			}
			flags := make([]bool, len(outcomes))
			for i := range outcomes {
				flags[i] = outcomes[i] == Solved
			}
			perLanguage = append(perLanguage, flags)
		}
		if perLanguage == nil {
			continue
		}
		if slices.Contains(summary.Tests, result.Test) {
			return nil, false // a test counted twice: the report is malformed
		}
		summary.Tests = append(summary.Tests, result.Test)
		for j, flags := range perLanguage {
			if len(flags) != len(perLanguage[0]) {
				return nil, false // not paired: the report is malformed
			}
			solved[j] = append(solved[j], flags)
		}
	}
	if len(solved[0]) == 0 {
		return nil, false
	}
	for _, f := range families {
		if !slices.Contains(summary.Tests, f.name) {
			summary.Missing = append(summary.Missing, f.name)
		}
	}

	for _, test := range solved[0] {
		summary.Problems += len(test)
	}
	share := func(tests [][]bool, draw [][]int) float64 {
		count := 0
		for t, test := range tests {
			for i := range test {
				if draw != nil {
					i = draw[t][i]
				}
				if test[i] {
					count++
				}
			}
		}
		return 100 * float64(count) / float64(summary.Problems)
	}

	// One set of draws serves every language, so their intervals answer to
	// the same resampled problem sets.
	random := &rng{state: 1}
	draws := make([][][]int, summaryResamples)
	for d := range draws {
		draws[d] = make([][]int, len(solved[0]))
		for t, test := range solved[0] {
			draws[d][t] = make([]int, len(test))
			for i := range test {
				draws[d][t][i] = random.intn(len(test))
			}
		}
	}

	baseline := share(solved[0], nil)
	for j, l := range languages {
		entry := LanguageSummary{Code: l.code, Name: l.name, Accuracy: share(solved[j], nil)}
		if j == 0 {
			entry.Baseline = true
			summary.Languages = append(summary.Languages, entry)
			continue
		}
		entry.Difference = entry.Accuracy - baseline
		differences := make([]float64, summaryResamples)
		for d, draw := range draws {
			differences[d] = share(solved[j], draw) - share(solved[0], draw)
		}
		slices.Sort(differences)
		entry.Low = differences[summaryResamples*25/1000]
		entry.High = differences[summaryResamples*975/1000-1]
		switch {
		case entry.High < 0:
			entry.Verdict = VerdictBelow
		case entry.Low > 0:
			entry.Verdict = VerdictAbove
		default:
			entry.Verdict = VerdictNone
		}
		summary.Languages = append(summary.Languages, entry)
	}
	return summary, true
}

// Print writes the summary as a table.
func (s *Summary) Print(w io.Writer) {
	fmt.Fprintf(w, "\nBY INPUT LANGUAGE — %d problems, each asked in every language\n", s.Problems)
	if coverage := s.Coverage(); coverage != "" {
		fmt.Fprintf(w, "  Not the whole suite: %s.\n", coverage)
	}
	tw := tabwriter.NewWriter(w, 2, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "  LANGUAGE\tSOLVED\tVS ENGLISH\t95% INTERVAL\tREADING\t")
	for _, l := range s.Languages {
		if l.Baseline {
			fmt.Fprintf(tw, "  %s\t%.1f%%\t\t\t\t\n", l.Name, l.Accuracy)
			continue
		}
		fmt.Fprintf(tw, "  %s\t%.1f%%\t%+.1f pp\t%+.1f … %+.1f pp\t%s\t\n",
			l.Name, l.Accuracy, l.Difference, l.Low, l.High, l.Verdict)
	}
	tw.Flush()
	fmt.Fprintln(w, "  The interval is a paired bootstrap over problems; a reading is given only when it lies on one side of zero.")
}
