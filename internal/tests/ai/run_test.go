package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func TestGrade(t *testing.T) {
	number := answer{hint: hintNumber, number: 1234}
	clara := answer{hint: hintPerson, choice: 2}
	tuesday := answer{hint: hintWeekday, choice: 1}
	pink := answer{hint: hintColour, choice: 10}
	zurich := answer{hint: hintCity, choice: 17}
	cases := []struct {
		name  string
		reply string
		want  answer
		grade byte
	}{
		{"plain", "34 + 1200 = 1234\nAnswer: 1234", number, Solved},
		{"wrong", "Answer: 1243", number, Wrong},
		{"no final line", "So the total is 1234.", number, NoAnswer},
		{"the last answer line counts", "Answer: 7\nWait, I miscounted.\nAnswer: 1234", number, Solved},
		{"markdown", "**Antwort:** `1234`", number, Solved},
		{"heading", "### Respuesta: 1234 paquetes", number, Solved},
		{"german thousands", "Antwort: 1.234", number, Solved},
		{"english thousands", "Answer: 1,234", number, Solved},
		{"spaced thousands", "Respuesta: 1 234", number, Solved},
		{"trailing zeros", "Answer: 1234.0", number, Solved},
		{"a decimal is not the whole number", "Answer: 1234.5", number, Wrong},
		{"negative", "Answer: -1234", number, Wrong},
		{"latex grouping", `Answer: \(1{,}234\)`, number, Solved},
		{"latex thin space", `Answer: $1\,234$`, number, Solved},
		{"a fraction is not its denominator", "Answer: 1/1234", number, Wrong},
		{"working in the line", "Answer: 1000 + 234 = 1234", number, Solved},
		{"full-width", "答案：１２３４", number, Solved},
		{"chinese with unit", "所以一共有1234个箱子。\n答案：1234个", number, Solved},
		{"words instead of digits", "Answer: one thousand", number, NoAnswer},
		{"answer on the next line", "Answer:\n1234", number, Solved},
		{"another language's marker", "I'll answer in English.\nAnswer: 1234", number, Solved},
		{"marker without a colon", "The answer is 1234", number, NoAnswer},

		{"name", "Antwort: Clara", clara, Solved},
		{"name in a sentence", "Respuesta: Clara ocupa esa posición.", clara, Solved},
		{"name in chinese", "答案：克拉拉", clara, Solved},
		{"latin name inside chinese", "答案：Clara是第四位", clara, Solved},
		{"two names", "Answer: Clara or Anna", clara, Wrong},
		{"another name", "Answer: Anna", clara, Wrong},
		{"no name", "Answer: the fourth person", clara, NoAnswer},
		{"part of another word", "Answer: Clarabella", clara, NoAnswer},

		{"weekday", "Answer: Tuesday", tuesday, Solved},
		{"weekday german", "Antwort: Dienstag", tuesday, Solved},
		{"weekday spanish", "Respuesta: martes", tuesday, Solved},
		{"weekday chinese", "答案：星期二", tuesday, Solved},
		{"weekday chinese short", "答案：周二", tuesday, Solved},
		{"wrong weekday", "Respuesta: miércoles", tuesday, Wrong},

		{"a longer word wins over the word inside it", "答案：粉红色", pink, Solved},
		{"colour across languages", "Antwort: Rosa", pink, Solved},
		{"accents are optional", "Respuesta: Zurich", zurich, Solved},
		{"umlaut", "Antwort: Zürich", zurich, Solved},
		{"chinese city", "答案：苏黎世", zurich, Solved},
	}
	for _, c := range cases {
		if got := grade(c.reply, c.want); got != c.grade {
			t.Errorf("%s: grade(%q) = %c, want %c", c.name, c.reply, got, c.grade)
		}
	}
}

// A spelling that named two different choices would make a correct answer
// count as wrong, in the languages that share the word.
func TestNoSpellingNamesTwoChoices(t *testing.T) {
	for hint := hintPerson; hint < hintCount; hint++ {
		seen := map[string]int{}
		for _, s := range vocabulary(hint) {
			if other, ok := seen[s.text]; ok && other != s.choice {
				t.Errorf("hint %d: %q names both choice %d and choice %d", hint, s.text, other, s.choice)
			}
			seen[s.text] = s.choice
		}
	}
}

// Every word a prompt uses for an answer must be read back as that answer.
func TestEveryPromptedWordIsAccepted(t *testing.T) {
	for _, l := range languages {
		check := func(hint hintKind, words []string) {
			for i, word := range words {
				reply := l.marker + ": " + word
				if got := grade(reply, answer{hint: hint, choice: i}); got != Solved {
					t.Errorf("%s: %q graded %c", l.code, reply, got)
				}
			}
		}
		check(hintPerson, l.people[:])
		check(hintCity, l.cities[:])
		check(hintColour, l.colours[:])
		check(hintWeekday, l.weekdays[:])
	}
}

// oracle is a model that knows every answer and gets wrong exactly what the
// test plants, so the scores it should receive are known in advance.
type oracle struct {
	answers map[string]string // prompt -> correct final line
	wrong   map[string]string // prompt -> a well-formed final line that is wrong
	// spoil replaces a reply. An empty text with stopEnd stands for a wrong
	// but well-formed answer.
	spoil func(language string, problem int) (text string, how stop, ok bool)
	where map[string][2]any // prompt -> language code, problem index

	mu       sync.Mutex
	asked    int
	inFlight atomic.Int32
	peak     atomic.Int32
}

func newOracle(t *testing.T, f family, quick bool) *oracle {
	t.Helper()
	o := &oracle{answers: map[string]string{}, wrong: map[string]string{}, where: map[string][2]any{}}
	for i, p := range f.problems(quick) {
		for _, l := range languages {
			want := p.solution()
			// The wrong answer is the neighbouring one: the next number, or
			// the next word of the same vocabulary.
			word := func(shift int) string {
				switch want.hint {
				case hintPerson:
					return l.people[(want.choice+shift)%peopleCount]
				case hintCity:
					return l.cities[(want.choice+shift)%cityCount]
				case hintColour:
					return l.colours[(want.choice+shift)%colourCount]
				case hintWeekday:
					return l.weekdays[(want.choice+shift)%7]
				}
				return fmt.Sprint(want.number + shift)
			}
			text := prompt(p, l)
			o.answers[text] = l.marker + ": " + word(0)
			o.wrong[text] = l.marker + ": " + word(1)
			o.where[text] = [2]any{l.code, i}
		}
	}
	return o
}

func (o *oracle) ask(ctx context.Context, prompt string) (reply, error) {
	now := o.inFlight.Add(1)
	defer o.inFlight.Add(-1)
	for {
		peak := o.peak.Load()
		if now <= peak || o.peak.CompareAndSwap(peak, now) {
			break
		}
	}
	time.Sleep(time.Millisecond)
	o.mu.Lock()
	o.asked++
	o.mu.Unlock()
	right, ok := o.answers[prompt]
	if !ok {
		return reply{}, errors.New("the oracle was asked something that is not in the problem set")
	}
	out := reply{text: "Let me think.\n" + right, stop: stopEnd, inputTokens: 100, outputTokens: 50}
	if o.spoil != nil {
		at := o.where[prompt]
		if text, how, ok := o.spoil(at[0].(string), at[1].(int)); ok {
			out.text, out.stop = text, how
			if text == "" && how == stopEnd {
				out.text = o.wrong[prompt]
			}
		}
	}
	return out, nil
}

func metric(t *testing.T, res *bench.Result, name string) float64 {
	t.Helper()
	for _, m := range res.Metrics {
		if m.Name == name {
			if m.Unit != "%" || !m.HigherIsBetter {
				t.Errorf("%s is %s, higher better %v", name, m.Unit, m.HigherIsBetter)
			}
			return m.Value
		}
	}
	t.Fatalf("no metric %s in %v", name, res.Metrics)
	return 0
}

func TestRunScoresWhatTheModelGotRight(t *testing.T) {
	for _, f := range families {
		t.Run(f.name, func(t *testing.T) {
			model := newOracle(t, f, false)
			// Planted: Chinese loses every fourth problem to a wrong answer,
			// German one reply to a missing final line, Spanish one to the
			// output limit and one to a refusal. The reply that was cut off
			// has an answer line, which must not be graded.
			model.spoil = func(language string, problem int) (string, stop, bool) {
				switch {
				case language == "zh" && problem%4 == 0:
					return "", stopEnd, true
				case language == "de" && problem == 3:
					return "Das ist schwer zu sagen.", stopEnd, true
				case language == "es" && problem == 5:
					return "Respuesta: 1\nMejor lo compruebo: primero sumo los", stopLimit, true
				case language == "es" && problem == 6:
					return "", stopRefusal, true
				}
				return "", "", false
			}
			target := &Target{API: apiOpenAI, Model: "oracle", Concurrency: 4}
			res, err := familyTest{f}.run(context.Background(), bench.Options{}, target, model)
			if err != nil {
				t.Fatal(err)
			}
			if model.asked != 160 {
				t.Errorf("asked %d times, want 160", model.asked)
			}
			if peak := model.peak.Load(); peak < 2 || peak > 4 {
				t.Errorf("at most %d requests were in flight, want 2 to 4", peak)
			}
			for name, want := range map[string]float64{
				"accuracy_en": 100, "accuracy_de": 97.5, "accuracy_es": 95, "accuracy_zh": 75,
			} {
				if got := metric(t, res, name); got != want {
					t.Errorf("%s = %v, want %v", name, got, want)
				}
			}
			if len(res.Metrics) != 4 {
				t.Errorf("%d metrics, want one per language", len(res.Metrics))
			}
			full := strings.Repeat("1", 40)
			wantOutcomes := map[string]string{
				"en": full,
				"de": "111-" + full[4:],
				"es": "11111--" + full[7:],
				"zh": strings.Repeat("0111", 10),
			}
			for code, want := range wantOutcomes {
				if got := res.Outcomes[code]; got != want {
					t.Errorf("outcomes[%s] = %s, want %s", code, got, want)
				}
			}
			notes := strings.Join(res.Notes, "\n")
			for _, want := range []string{
				"40 problems, each asked in English, German, Spanish and Chinese",
				"replies without a final answer line that could be read: en 0, de 1, es 0, zh 0",
				"replies cut off at the output limit: en 0, de 0, es 1, zh 0",
				"requests the model declined: en 0, de 0, es 1, zh 0",
				"mean output tokens per reply: en 50, de 50, es 50, zh 50",
			} {
				if !strings.Contains(notes, want) {
					t.Errorf("notes lack %q:\n%s", want, notes)
				}
			}
		})
	}
}

func TestQuickRunAsksTheSmallSet(t *testing.T) {
	f := familyNamed(t, "calendar")
	model := newOracle(t, f, true)
	res, err := familyTest{f}.run(context.Background(), bench.Options{Quick: true}, &Target{Model: "oracle", Concurrency: 2}, model)
	if err != nil {
		t.Fatal(err)
	}
	if model.asked != 40 || len(res.Outcomes["zh"]) != 10 {
		t.Errorf("asked %d, %d outcomes per language; want 40 and 10", model.asked, len(res.Outcomes["zh"]))
	}
}

type failingModel struct {
	after int32
	asked atomic.Int32
}

func (m *failingModel) ask(context.Context, string) (reply, error) {
	if m.asked.Add(1) > m.after {
		return reply{}, errors.New("529 overloaded")
	}
	return reply{text: "Answer: 1", stop: stopEnd}, nil
}

// servedModel answers every problem and names the model that did.
type servedModel struct {
	names []string
	asked atomic.Int32
}

func (m *servedModel) ask(context.Context, string) (reply, error) {
	n := int(m.asked.Add(1))
	return reply{text: "Answer: 1", stop: stopEnd, model: m.names[n%len(m.names)]}, nil
}

// A gateway can answer with another model than the one asked for. The report
// keeps the requested name, so the substitution has to show in the notes.
func TestASubstitutedModelIsNamedInTheNotes(t *testing.T) {
	for _, c := range []struct {
		names []string
		want  string
	}{
		{[]string{"asked"}, ""},
		{[]string{""}, ""},
		{[]string{"other"}, "the endpoint named another answering model than the requested asked: other (40 replies)"},
		{[]string{"asked", "other"}, "the endpoint named another answering model than the requested asked: asked (20 replies), other (20 replies)"},
	} {
		model := &servedModel{names: c.names}
		res, err := familyTest{familyNamed(t, "calendar")}.run(context.Background(), bench.Options{Quick: true}, &Target{Model: "asked", Concurrency: 1}, model)
		if err != nil {
			t.Fatal(err)
		}
		got := ""
		for _, note := range res.Notes {
			if strings.Contains(note, "answering model") {
				got = note
			}
		}
		if got != c.want {
			t.Errorf("served by %q: note %q, want %q", c.names, got, c.want)
		}
	}
}

// flakyModel fails one request once, the way a gateway does now and then.
type flakyModel struct {
	fail  int32
	asked atomic.Int32
}

func (m *flakyModel) ask(context.Context, string) (reply, error) {
	if m.asked.Add(1) == m.fail {
		return reply{}, errors.New("400 Invalid request data")
	}
	return reply{text: "Answer: 1", stop: stopEnd}, nil
}

// One failed request is asked again and does not cost the whole test. The
// very first request is the exception: it is what catches a wrong model name.
func TestASingleFailedRequestIsAskedAgain(t *testing.T) {
	retryPause = time.Millisecond
	defer func() { retryPause = 5 * time.Second }()
	run := func(fail int32) (*bench.Result, error, int32) {
		model := &flakyModel{fail: fail}
		res, err := familyTest{familyNamed(t, "calendar")}.run(context.Background(), bench.Options{Quick: true}, &Target{Model: "m", Concurrency: 4}, model)
		return res, err, model.asked.Load()
	}
	if res, err, asked := run(17); err != nil || res == nil || asked != 41 {
		t.Errorf("a failure in the middle: result %v, error %v, %d requests, want 41", res, err, asked)
	}
	if res, err, asked := run(1); err == nil || res != nil || asked != 1 {
		t.Errorf("a failure of the first request: result %v, error %v, %d requests, want an error after one", res, err, asked)
	}
}

// lastWordModel answers everything and interrupts the run with its last
// answer, the way a signal can arrive while the final reply comes in.
type lastWordModel struct {
	last   int32
	cancel context.CancelFunc
	asked  atomic.Int32
}

func (m *lastWordModel) ask(context.Context, string) (reply, error) {
	if m.asked.Add(1) == m.last {
		m.cancel()
	}
	return reply{text: "Answer: 1", stop: stopEnd}, nil
}

// A run that got every answer is complete, even when it was interrupted
// while the last one arrived.
func TestAnInterruptedRunKeepsACompleteResult(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	model := &lastWordModel{last: 40, cancel: cancel}
	res, err := familyTest{familyNamed(t, "calendar")}.run(ctx, bench.Options{Quick: true}, &Target{Model: "m", Concurrency: 1}, model)
	if err != nil || res == nil || len(res.Outcomes["zh"]) != 10 {
		t.Errorf("result %v, error %v", res, err)
	}
}

// A request that fails is not a wrong answer: the test has no result.
func TestAFailedRequestFailsTheTestInsteadOfCountingAsWrong(t *testing.T) {
	retryPause = time.Millisecond
	defer func() { retryPause = 5 * time.Second }()
	for _, after := range []int32{0, 25} {
		model := &failingModel{after: after}
		res, err := familyTest{familyNamed(t, "ordering")}.run(context.Background(), bench.Options{}, &Target{Model: "m", Concurrency: 4}, model)
		if err == nil || !strings.Contains(err.Error(), "ordering: 529 overloaded") || res != nil {
			t.Errorf("after %d answers: result %v, error %v", after, res, err)
		}
		// The run stops soon after the failure instead of sending the rest:
		// each of the four workers gives up after its attempts.
		if asked := model.asked.Load(); asked > after+4*attempts {
			t.Errorf("after %d answers: %d requests were sent", after, asked)
		}
	}
}

func TestTranscriptRecordsEveryExchange(t *testing.T) {
	f := familyNamed(t, "arithmetic")
	path := filepath.Join(t.TempDir(), "transcript.jsonl")
	target := &Target{Model: "oracle", Concurrency: 3, transcript: path}
	if _, err := (familyTest{f}).run(context.Background(), bench.Options{Quick: true}, target, newOracle(t, f, true)); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	lines := 0
	scanner := bufio.NewScanner(file)
	scanner.Buffer(nil, 1<<20)
	for scanner.Scan() {
		var line transcriptLine
		if err := json.Unmarshal(scanner.Bytes(), &line); err != nil {
			t.Fatal(err)
		}
		if line.Test != "arithmetic" || line.Prompt == "" || line.Reply == "" || line.Outcome != "1" || line.OutputTokens != 50 {
			t.Fatalf("unexpected line %+v", line)
		}
		lines++
	}
	if lines != 40 {
		t.Errorf("%d transcript lines, want 40", lines)
	}
}

// Answers that were paid for are kept when a later request fails, and a
// transcript that cannot be written is found out before anything is asked.
func TestTranscriptSurvivesAFailedRun(t *testing.T) {
	retryPause = time.Millisecond
	defer func() { retryPause = 5 * time.Second }()
	path := filepath.Join(t.TempDir(), "transcript.jsonl")
	model := &failingModel{after: 25}
	target := &Target{Model: "m", Concurrency: 1, transcript: path}
	if _, err := (familyTest{familyNamed(t, "calendar")}).run(context.Background(), bench.Options{Quick: true}, target, model); err == nil {
		t.Fatal("the run did not fail")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if lines := strings.Count(string(data), "\n"); lines != 25 {
		t.Errorf("%d transcript lines, want the 25 answers before the failure", lines)
	}

	model = &failingModel{after: 25}
	target.transcript = filepath.Join(t.TempDir(), "missing", "transcript.jsonl")
	_, err = (familyTest{familyNamed(t, "calendar")}).run(context.Background(), bench.Options{Quick: true}, target, model)
	if err == nil || !strings.Contains(err.Error(), "transcript") || model.asked.Load() != 0 {
		t.Errorf("an unwritable transcript: error %v after %d requests", err, model.asked.Load())
	}
}

// Credentials reach the configured address and nothing else: not a redirect
// target, and not the text of an error, which is printed and stored.
func TestCredentialsStayWithTheConfiguredEndpoint(t *testing.T) {
	const secret = "sk-test-0123456789"
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { elsewhere.Add(1) }))
	defer other.Close()
	var asked atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if asked.Add(1) == 1 {
			// A redirect whose body would pass for a reply.
			w.Header().Set("Location", other.URL+r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTemporaryRedirect)
			fmt.Fprint(w, `{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[{"type":"text","text":"Answer: 1"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`)
			return
		}
		// An endpoint that repeats the credential it was sent, far enough
		// into its message that a shortened copy would cut the key in two.
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprintf(w, `{"error":{"message":"invalid key %s %s%s"}}`, strings.Repeat("x", 249), r.Header.Get("Authorization"), r.Header.Get("X-Api-Key"))
	}))
	defer server.Close()

	for _, name := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"} {
		t.Setenv(name, "")
	}
	t.Setenv("ANTHROPIC_API_KEY", secret)
	for _, target := range []*Target{
		{API: apiOpenAI, Model: "m", Endpoint: "example.test", baseURL: server.URL, apiKey: secret},
		// No ANTHROPIC_BASE_URL: the address comes from the target alone.
		{API: apiAnthropic, Model: "m", Endpoint: "example.test", baseURL: server.URL, MaxTokens: 100},
	} {
		asked.Store(0)
		model := newClient(target)
		if _, err := model.ask(context.Background(), "x"); err == nil || asked.Load() != 1 || elsewhere.Load() != 0 {
			t.Errorf("%s, a redirect: error %v, %d requests here, %d at the redirect target", target.API, err, asked.Load(), elsewhere.Load())
		}
		_, err := model.ask(context.Background(), "x")
		if err == nil || strings.Contains(err.Error(), secret[:8]) || !strings.Contains(err.Error(), "invalid key") || !strings.Contains(err.Error(), "[credent") {
			t.Errorf("%s, an echoed credential: error %v", target.API, err)
		}
	}
}

func TestOpenAIClientSpeaksChatCompletions(t *testing.T) {
	var bodies []map[string]any
	var auth []string
	status := []int{http.StatusTooManyRequests, http.StatusOK}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(data, &body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		auth = append(auth, r.Header.Get("Authorization"))
		code := status[0]
		if len(status) > 1 {
			status = status[1:]
		}
		if code != http.StatusOK {
			http.Error(w, `{"error":{"message":"slow down"}}`, code)
			return
		}
		fmt.Fprint(w, `{"model":"some/model-0613","choices":[{"message":{"role":"assistant","content":"Antwort: 12"},"finish_reason":"stop"}],"usage":{"prompt_tokens":40,"completion_tokens":9}}`)
	}))
	defer server.Close()

	target := &Target{API: apiOpenAI, Model: "some/model", Endpoint: "test", baseURL: server.URL + "/v1", apiKey: "secret"}
	model := &openAIClient{target: target, http: server.Client(), backoff: time.Millisecond}
	got, err := model.ask(context.Background(), "Frage?")
	if err != nil {
		t.Fatal(err)
	}
	if want := (reply{text: "Antwort: 12", stop: stopEnd, model: "some/model-0613", inputTokens: 40, outputTokens: 9}); got != want {
		t.Errorf("reply %+v, want %+v", got, want)
	}
	if len(bodies) != 2 {
		t.Fatalf("%d requests, want a retry after the 429", len(bodies))
	}
	// Nothing but the model and one user message: no system prompt, no
	// sampling parameters, and no limits the user did not ask for.
	want := `{"messages":[{"content":"Frage?","role":"user"}],"model":"some/model"}`
	if data, _ := json.Marshal(bodies[1]); string(data) != want {
		t.Errorf("request body %s, want %s", data, want)
	}
	if auth[1] != "Bearer secret" {
		t.Errorf("authorization %q", auth[1])
	}

	// Effort and an output limit are sent only when set.
	target.Effort, target.MaxTokens = "high", 2000
	if _, err := model.ask(context.Background(), "Frage?"); err != nil {
		t.Fatal(err)
	}
	last := bodies[len(bodies)-1]
	if last["reasoning_effort"] != "high" || last["max_completion_tokens"] != float64(2000) {
		t.Errorf("request body %v lacks the effort or the limit", last)
	}
}

func TestOpenAIClientReadsRefusalsLimitsAndErrors(t *testing.T) {
	response := ""
	code := http.StatusOK
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(code)
		fmt.Fprint(w, response)
	}))
	defer server.Close()
	model := &openAIClient{
		target:  &Target{Model: "m", Endpoint: "example.test", baseURL: server.URL},
		http:    server.Client(),
		backoff: time.Millisecond,
	}

	response = `{"choices":[{"message":{"content":null,"refusal":"no"},"finish_reason":"content_filter"}]}`
	if got, err := model.ask(context.Background(), "x"); err != nil || got.stop != stopRefusal || got.text != "" {
		t.Errorf("refusal: %+v, %v", got, err)
	}
	response = `{"choices":[{"message":{"content":"Primero"},"finish_reason":"length"}]}`
	if got, err := model.ask(context.Background(), "x"); err != nil || got.stop != stopLimit {
		t.Errorf("limit: %+v, %v", got, err)
	}

	// A request the server rejects is not retried, and the error says who
	// rejected it and why.
	requests, code, response = 0, http.StatusNotFound, `{"error":{"message":"model m does not exist"}}`
	_, err := model.ask(context.Background(), "x")
	if err == nil || requests != 1 || !strings.Contains(err.Error(), "example.test answered 404") || !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("404: %d requests, error %v", requests, err)
	}
	// An overloaded server is retried, then given up on.
	requests, code = 0, http.StatusServiceUnavailable
	if _, err := model.ask(context.Background(), "x"); err == nil || requests != maxRetries+1 {
		t.Errorf("503: %d requests, error %v", requests, err)
	}
	requests, code, response = 0, http.StatusOK, `{"choices":[]}`
	if _, err := model.ask(context.Background(), "x"); err == nil || requests != 1 {
		t.Errorf("no choices: %d requests, error %v", requests, err)
	}
}

func TestAnthropicClientSpeaksMessages(t *testing.T) {
	var bodies []map[string]any
	response := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		data, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(data, &body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, response)
	}))
	defer server.Close()

	message := func(stopReason, content string) string {
		return `{"id":"msg_1","type":"message","role":"assistant","model":"claude-test","content":` + content +
			`,"stop_reason":"` + stopReason + `","stop_sequence":null,"usage":{"input_tokens":61,"output_tokens":17}}`
	}
	target := &Target{API: apiAnthropic, Model: "claude-test", MaxTokens: anthropicMaxTokens}
	model := &anthropicClient{
		target: target,
		sdk:    anthropic.NewClient(option.WithBaseURL(server.URL), option.WithAPIKey("test"), option.WithMaxRetries(0), option.WithRequestTimeout(requestTimeout)),
	}

	// Thinking blocks are not part of the answer.
	response = message("end_turn", `[{"type":"thinking","thinking":"","signature":"s"},{"type":"text","text":"Answer: "},{"type":"text","text":"12"}]`)
	got, err := model.ask(context.Background(), "Question?")
	if err != nil {
		t.Fatal(err)
	}
	if want := (reply{text: "Answer: 12", stop: stopEnd, model: "claude-test", inputTokens: 61, outputTokens: 17}); got != want {
		t.Errorf("reply %+v, want %+v", got, want)
	}
	// The request names the model and nothing that would change who answers
	// or how: no system prompt, sampling, thinking override or fallback.
	want := `{"max_tokens":32000,"messages":[{"content":[{"text":"Question?","type":"text"}],"role":"user"}],"model":"claude-test"}`
	if data, _ := json.Marshal(bodies[0]); string(data) != want {
		t.Errorf("request body %s, want %s", data, want)
	}

	target.Effort = "low"
	response = message("refusal", `[]`)
	if got, err := model.ask(context.Background(), "Question?"); err != nil || got.stop != stopRefusal || got.text != "" {
		t.Errorf("refusal: %+v, %v", got, err)
	}
	if config, _ := bodies[1]["output_config"].(map[string]any); config["effort"] != "low" {
		t.Errorf("request body %v lacks the effort", bodies[1])
	}
	response = message("max_tokens", `[{"type":"text","text":"First"}]`)
	if got, err := model.ask(context.Background(), "Question?"); err != nil || got.stop != stopLimit {
		t.Errorf("limit: %+v, %v", got, err)
	}
}

func TestLoadTarget(t *testing.T) {
	clear := func(t *testing.T) {
		for _, name := range []string{
			"PB_AI_API", "PB_AI_MODEL", "PB_AI_BASE_URL", "PB_AI_API_KEY", "PB_AI_EFFORT", "PB_AI_MAX_TOKENS",
			"PB_AI_CONCURRENCY", "PB_AI_TRANSCRIPT", "OPENAI_API_KEY", "ANTHROPIC_BASE_URL",
		} {
			t.Setenv(name, "")
		}
	}
	t.Run("anthropic", func(t *testing.T) {
		clear(t)
		t.Setenv("PB_AI_API", "Anthropic")
		t.Setenv("PB_AI_MODEL", "claude-opus-5-5")
		target, err := LoadTarget()
		if err != nil {
			t.Fatal(err)
		}
		if target.Endpoint != "api.anthropic.com" || target.MaxTokens != 32000 || target.Concurrency != 4 {
			t.Errorf("target %+v", target)
		}
		provider, product, plan, region := target.Identity()
		if provider != "anthropic" || product != "api" || plan != "claude-opus-5-5" || region != "global" {
			t.Errorf("identity %s %s %s %s", provider, product, plan, region)
		}
		env := target.Environment()
		if env["ai_api"] != "anthropic" || env["ai_endpoint"] != "api.anthropic.com" || env["ai_effort"] != "provider default" || env["ai_max_tokens"] != "32000" {
			t.Errorf("environment %v", env)
		}
	})
	t.Run("a proxy in front of anthropic is recorded", func(t *testing.T) {
		clear(t)
		t.Setenv("PB_AI_API", "anthropic")
		t.Setenv("PB_AI_MODEL", "claude-opus-5-5")
		t.Setenv("ANTHROPIC_BASE_URL", "http://127.0.0.1:8080")
		target, err := LoadTarget()
		if err != nil || target.Endpoint != "127.0.0.1:8080" {
			t.Errorf("target %+v, %v", target, err)
		}
	})
	t.Run("openai", func(t *testing.T) {
		clear(t)
		t.Setenv("PB_AI_API", "openai")
		t.Setenv("PB_AI_MODEL", "gpt-x")
		t.Setenv("OPENAI_API_KEY", "sk-openai")
		t.Setenv("PB_AI_EFFORT", "high")
		t.Setenv("PB_AI_CONCURRENCY", "9")
		target, err := LoadTarget()
		if err != nil {
			t.Fatal(err)
		}
		if target.apiKey != "sk-openai" || target.baseURL != "https://api.openai.com/v1" || target.MaxTokens != 0 || target.Concurrency != 9 {
			t.Errorf("target %+v", target)
		}
		if provider, _, _, _ := target.Identity(); provider != "openai" {
			t.Errorf("provider %s", provider)
		}
		if env := target.Environment(); env["ai_effort"] != "high" || env["ai_max_tokens"] != "provider default" {
			t.Errorf("environment %v", env)
		}
	})
	t.Run("an openai key never goes to another endpoint", func(t *testing.T) {
		clear(t)
		t.Setenv("PB_AI_API", "openai")
		t.Setenv("PB_AI_MODEL", "llama")
		t.Setenv("PB_AI_BASE_URL", "http://localhost:1234/v1/")
		t.Setenv("OPENAI_API_KEY", "sk-openai")
		target, err := LoadTarget()
		if err != nil {
			t.Fatal(err)
		}
		if target.apiKey != "" || target.baseURL != "http://localhost:1234/v1" {
			t.Errorf("target %+v", target)
		}
		if provider, _, plan, _ := target.Identity(); provider != "localhost:1234" || plan != "llama" {
			t.Errorf("identity %s %s", provider, plan)
		}
	})
	t.Run("what is missing is named", func(t *testing.T) {
		clear(t)
		if _, err := LoadTarget(); err == nil || !strings.Contains(err.Error(), "PB_AI_API") {
			t.Errorf("no api: %v", err)
		}
		t.Setenv("PB_AI_API", "openai")
		if _, err := LoadTarget(); err == nil || !strings.Contains(err.Error(), "PB_AI_MODEL") {
			t.Errorf("no model: %v", err)
		}
		t.Setenv("PB_AI_MODEL", "m")
		t.Setenv("PB_AI_BASE_URL", "localhost:1234")
		if _, err := LoadTarget(); err == nil || !strings.Contains(err.Error(), "http(s) URL") {
			t.Errorf("bad url: %v", err)
		}
		t.Setenv("PB_AI_BASE_URL", "")
		t.Setenv("PB_AI_MAX_TOKENS", "many")
		if _, err := LoadTarget(); err == nil || !strings.Contains(err.Error(), "PB_AI_MAX_TOKENS") {
			t.Errorf("bad limit: %v", err)
		}
	})
}

func TestSummarize(t *testing.T) {
	result := func(test, en, de, es, zh string) bench.Result {
		return bench.Result{Test: test, Outcomes: map[string]string{"en": en, "de": de, "es": es, "zh": zh}}
	}
	all, none := strings.Repeat("1", 40), strings.Repeat("0", 40)
	report := &bench.Report{Category: Category, Results: []bench.Result{
		// German is identical to English, Spanish trades one problem for
		// another, Chinese loses a quarter of everything.
		result("arithmetic", all, all, "0"+all[1:], strings.Repeat("0111", 10)),
		result("ordering", none[:20]+all[:20], none[:20]+all[:20], none[:19]+all[:21], none[:20]+strings.Repeat("0111", 5)),
		{Test: "reading", Error: "529 overloaded"}, // a failed test has no outcomes
	}}
	summary, ok := Summarize(report)
	if !ok {
		t.Fatal("no summary")
	}
	if summary.Problems != 80 || len(summary.Languages) != 4 {
		t.Fatalf("summary %+v", summary)
	}
	// The failed test and the two that never ran are named, not dropped.
	if got := summary.Coverage(); got != "only arithmetic, ordering" {
		t.Errorf("coverage %q", got)
	}
	en, de, es, zh := summary.Languages[0], summary.Languages[1], summary.Languages[2], summary.Languages[3]
	if !en.Baseline || en.Accuracy != 75 || en.Verdict != "" {
		t.Errorf("english %+v", en)
	}
	if de.Accuracy != 75 || de.Difference != 0 || de.Low != 0 || de.High != 0 || de.Verdict != VerdictNone {
		t.Errorf("german %+v", de)
	}
	// One problem lost and one gained: no difference, and an interval that
	// says so by covering zero.
	if es.Difference != 0 || es.Low >= 0 || es.High <= 0 || es.Verdict != VerdictNone {
		t.Errorf("spanish %+v", es)
	}
	// 15 of 80 lost and none gained: the whole interval is below zero.
	if zh.Accuracy != 56.25 || zh.Difference != -18.75 || zh.High >= 0 || zh.Low >= zh.Difference || zh.Verdict != VerdictBelow {
		t.Errorf("chinese %+v", zh)
	}
	again, _ := Summarize(report)
	if again.Languages[3] != zh {
		t.Error("the summary is not reproducible")
	}

	if _, ok := Summarize(&bench.Report{Category: "compute"}); ok {
		t.Error("a compute report has no language summary")
	}
	if _, ok := Summarize(&bench.Report{Category: Category, Results: []bench.Result{{Test: "reading", Error: "x"}}}); ok {
		t.Error("a report without outcomes has no language summary")
	}
	one := result("calendar", all, all, all, all)
	if s, ok := Summarize(&bench.Report{Category: Category, Results: []bench.Result{one}}); !ok || s.Coverage() != "only calendar" {
		t.Errorf("a single test: %+v", s)
	}
	if _, ok := Summarize(&bench.Report{Category: Category, Results: []bench.Result{one, one}}); ok {
		t.Error("a test counted twice has no language summary")
	}
}
