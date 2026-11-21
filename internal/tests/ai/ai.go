// Package ai measures how well a language model solves problems depending on
// the language they are posed in.
//
// Each test is one family of reasoning problems. Every problem is generated
// from a fixed seed and written out in every language of the suite: the same
// quantities, the same people, the same answer. A model therefore answers
// identical questions in English, German, Spanish and Chinese, and a
// difference between its scores is a difference in how it handles the
// language, not in what it was asked.
//
// The problems are generated, not collected, so they cannot have been read
// during training, and every answer is checked by rule: no second model
// judges the first.
//
// The model to measure comes from the environment (see Target). Unlike the
// other suites, nothing here measures the machine the benchmark runs on.
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// Category is the report category every test in this package belongs to.
const Category = "ai-language"

func init() {
	for _, f := range families {
		bench.Register(familyTest{f})
	}
}

type familyTest struct{ family }

func (t familyTest) Name() string        { return t.name }
func (t familyTest) Category() string    { return Category }
func (t familyTest) Description() string { return t.description + ", in four languages" }

func (t familyTest) Run(ctx context.Context, opts bench.Options) (*bench.Result, error) {
	target, err := LoadTarget()
	if err != nil {
		return nil, err
	}
	return t.run(ctx, opts, target, newClient(target))
}

// exchange is one problem put to the model in one language.
type exchange struct {
	problem  int
	language int
	prompt   string
	want     answer

	reply   reply
	outcome byte
	seconds float64
}

func (t familyTest) run(ctx context.Context, opts bench.Options, target *Target, model client) (*bench.Result, error) {
	res := bench.NewResult(t.name)
	problems := t.problems(opts.Quick)

	// Problem by problem, language by language: whatever changes at the
	// provider while the test runs touches every language alike.
	exchanges := make([]*exchange, 0, len(problems)*len(languages))
	for i, p := range problems {
		for j, l := range languages {
			exchanges = append(exchanges, &exchange{problem: i, language: j, prompt: prompt(p, l), want: p.solution()})
		}
	}
	opts.Logf("%s: %d problems × %d languages = %d requests to %s", t.name, len(problems), len(languages), len(exchanges), target.Model)

	// The transcript is opened before anything is asked, so a path that
	// cannot be written costs no request, and it is written even when a
	// request fails: the answers before it were paid for.
	transcript, err := openTranscript(target.transcript)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}
	err = askAll(ctx, opts, t.name, target, model, exchanges)
	if writeErr := writeTranscript(transcript, t.name, exchanges); err == nil {
		err = writeErr
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", t.name, err)
	}

	res.Outcomes = make(map[string]string, len(languages))
	unread := make([]int, len(languages))
	refused := make([]int, len(languages))
	cut := make([]int, len(languages))
	tokens := make([]int, len(languages))
	outcomes := make([][]byte, len(languages))
	for _, e := range exchanges {
		outcomes[e.language] = append(outcomes[e.language], e.outcome)
		tokens[e.language] += e.reply.outputTokens
		switch {
		case e.reply.stop == stopRefusal:
			refused[e.language]++
		case e.reply.stop == stopLimit:
			cut[e.language]++
		case e.outcome == NoAnswer:
			unread[e.language]++
		}
	}
	for j, l := range languages {
		res.Outcomes[l.code] = string(outcomes[j])
		res.Add("accuracy_"+l.code, Accuracy(res.Outcomes[l.code]), "%", true)
	}

	res.Note("%d problems, each asked in %s; accuracy is the share answered correctly", len(problems), languageList())
	perLanguage := func(counts []int) string {
		parts := make([]string, len(languages))
		for j, l := range languages {
			parts[j] = fmt.Sprintf("%s %d", l.code, counts[j])
		}
		return strings.Join(parts, ", ")
	}
	for _, kind := range []struct {
		what   string
		counts []int
	}{
		{"replies without a final answer line that could be read", unread},
		{"replies cut off at the output limit", cut},
		{"requests the model declined", refused},
	} {
		if sum(kind.counts) > 0 {
			res.Note("%s: %s", kind.what, perLanguage(kind.counts))
		}
	}
	if sum(tokens) > 0 {
		for j := range tokens {
			tokens[j] = (tokens[j] + len(problems)/2) / len(problems)
		}
		res.Note("mean output tokens per reply: %s", perLanguage(tokens))
	}
	if others := servedBy(target.Model, exchanges); others != "" {
		res.Note("the endpoint named another answering model than the requested %s: %s", target.Model, others)
	}
	res.Finish()
	// Every problem was answered, so the result stands even when the run was
	// interrupted in this very moment.
	return res, nil
}

// servedBy lists the models the endpoint says answered, with the number of
// replies each, when that is anything but the requested model alone. A report
// names the model that was asked for; this is where a substitution shows.
func servedBy(requested string, exchanges []*exchange) string {
	counts := map[string]int{}
	for _, e := range exchanges {
		if e.reply.model != "" {
			counts[e.reply.model]++
		}
	}
	if len(counts) == 0 || len(counts) == 1 && counts[requested] > 0 {
		return ""
	}
	parts := make([]string, 0, len(counts))
	for _, name := range slices.Sorted(maps.Keys(counts)) {
		parts = append(parts, fmt.Sprintf("%s (%d replies)", name, counts[name]))
	}
	return strings.Join(parts, ", ")
}

// attempts is how often a request is made before the test gives up. The
// clients already retry what an API marks as temporary; this covers a gateway
// that fails a single request without saying it may be repeated.
const attempts = 3

// retryPause is the wait before such a repeat; tests shorten it.
var retryPause = 5 * time.Second

// askAll sends every exchange and grades the replies. The first one goes out
// alone and once, so a wrong model name or a missing key fails clearly; the
// rest run a few at a time.
func askAll(ctx context.Context, opts bench.Options, test string, target *Target, model client, exchanges []*exchange) error {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	var done int
	var mu sync.Mutex
	ask := func(e *exchange, tries int) {
		var began time.Time
		var r reply
		var err error
		for try := 1; ; try++ {
			began = time.Now()
			if r, err = model.ask(ctx, e.prompt); err == nil || try == tries || ctx.Err() != nil {
				break
			}
			opts.Logf("%s: a request failed and is tried again: %v", test, err)
			select {
			case <-ctx.Done():
			case <-time.After(retryPause):
			}
		}
		if err != nil {
			cancel(err)
			return
		}
		e.reply = r
		e.seconds = time.Since(began).Seconds()
		// A reply that was cut off or declined has no final answer, whatever
		// stands in the text that did arrive.
		e.outcome = NoAnswer
		if r.stop != stopLimit && r.stop != stopRefusal {
			e.outcome = grade(r.text, e.want)
		}
		mu.Lock()
		done++
		if done%20 == 0 || done == len(exchanges) {
			opts.Logf("%s: %d of %d answered", test, done, len(exchanges))
		}
		mu.Unlock()
	}

	ask(exchanges[0], 1)
	queue := make(chan *exchange)
	var workers sync.WaitGroup
	for range target.Concurrency {
		workers.Go(func() {
			for e := range queue {
				if ctx.Err() == nil {
					ask(e, attempts)
				}
			}
		})
	}
	for _, e := range exchanges[1:] {
		queue <- e
	}
	close(queue)
	workers.Wait()
	// With every answer in, the test is complete even when the run was
	// interrupted while the last one arrived.
	if done == len(exchanges) {
		return nil
	}
	return context.Cause(ctx)
}

// transcriptLine is one exchange as written to PB_AI_TRANSCRIPT. The file is
// the way to see why a model lost a point: the report itself only says that
// it did.
type transcriptLine struct {
	Test         string  `json:"test"`
	Problem      int     `json:"problem"`
	Language     string  `json:"language"`
	Prompt       string  `json:"prompt"`
	Reply        string  `json:"reply"`
	Stop         stop    `json:"stop"`
	Model        string  `json:"model,omitempty"`
	Outcome      string  `json:"outcome"`
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	Seconds      float64 `json:"seconds"`
}

// openTranscript opens the transcript file for appending; without a path
// there is none.
func openTranscript(path string) (*os.File, error) {
	if path == "" {
		return nil, nil
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("transcript: %w", err)
	}
	return file, nil
}

// writeTranscript appends every exchange that was answered and closes the
// file.
func writeTranscript(file *os.File, test string, exchanges []*exchange) error {
	if file == nil {
		return nil
	}
	encoder := json.NewEncoder(file)
	encoder.SetEscapeHTML(false)
	for _, e := range exchanges {
		if e.outcome == 0 {
			continue // never answered: a request failed before its turn
		}
		line := transcriptLine{
			Test: test, Problem: e.problem, Language: languages[e.language].code,
			Prompt: e.prompt, Reply: e.reply.text, Stop: e.reply.stop, Model: e.reply.model, Outcome: string(e.outcome),
			InputTokens: e.reply.inputTokens, OutputTokens: e.reply.outputTokens, Seconds: e.seconds,
		}
		if err := encoder.Encode(line); err != nil {
			file.Close()
			return fmt.Errorf("transcript: %w", err)
		}
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("transcript: %w", err)
	}
	return nil
}

// Accuracy is the share of solved problems in an outcome string, in percent.
func Accuracy(outcomes string) float64 {
	if outcomes == "" {
		return 0
	}
	return 100 * float64(strings.Count(outcomes, string(rune(Solved)))) / float64(len(outcomes))
}

func languageList() string {
	names := make([]string, len(languages))
	for i, l := range languages {
		names[i] = l.name
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

func sum(values []int) int {
	total := 0
	for _, v := range values {
		total += v
	}
	return total
}
