package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

// An ai-language run against a stand-in endpoint: the report names the model it
// measured, records how it was asked, validates, and can be compared.
func TestRunWritesAnAIReport(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		data, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(data, &body); err != nil || body.Model != "stand-in" || len(body.Messages) != 1 {
			t.Errorf("unexpected request %s", data)
		}
		// Always Monday: right about one time in seven, in every language.
		fmt.Fprint(w, `{"choices":[{"message":{"content":"Answer: Monday"},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":4}}`)
	}))
	defer server.Close()

	for _, name := range []string{"PB_AI_EFFORT", "PB_AI_MAX_TOKENS", "PB_AI_API_KEY", "PB_AI_TRANSCRIPT", "OPENAI_API_KEY"} {
		t.Setenv(name, "")
	}
	t.Setenv("PB_AI_API", "openai")
	t.Setenv("PB_AI_MODEL", "stand-in")
	t.Setenv("PB_AI_BASE_URL", server.URL+"/v1")
	t.Setenv("PB_AI_CONCURRENCY", "8")

	version = "test" // main sets it; a report needs one
	path := filepath.Join(t.TempDir(), "report.json")
	if code := runCmd([]string{"--category", "ai-language", "-t", "calendar", "--quick", "--json", path}); code != 0 {
		t.Fatalf("run exited %d", code)
	}
	if got := requests.Load(); got != 40 {
		t.Errorf("%d requests, want 10 problems in 4 languages", got)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	report, errs := bench.ValidateReport(data)
	if len(errs) != 0 {
		t.Fatalf("the report does not validate: %v", errs)
	}
	host := strings.TrimPrefix(server.URL, "http://")
	if report.Category != "ai-language" || report.ProtocolVersion != "ai-language-v1" || !report.Quick {
		t.Errorf("identity %s %s quick=%v", report.Category, report.ProtocolVersion, report.Quick)
	}
	if p := report.Provider; p.Name != host || p.Product != "api" || p.Plan != "stand-in" || p.Region != "global" {
		t.Errorf("provider %+v", p)
	}
	for key, want := range map[string]string{
		"ai_api": "openai", "ai_endpoint": host, "ai_effort": "provider default",
		"ai_max_tokens": "provider default", "ai_sampling": "provider default",
	} {
		if got := report.Environment[key]; got != want {
			t.Errorf("environment[%s] = %q, want %q", key, got, want)
		}
	}
	result := report.Results[0]
	if result.Test != "calendar" || len(result.Metrics) != 4 || len(result.Outcomes["de"]) != 10 {
		t.Errorf("result %+v", result)
	}
	if result.Outcomes["en"] != result.Outcomes["zh"] {
		t.Errorf("a constant answer scored differently by language: %v", result.Outcomes)
	}

	if code := languagesCmd([]string{path}); code != 0 {
		t.Errorf("languages exited %d", code)
	}

	// The plan of an ai-language report is the model: any other name is refused
	// before a request is sent.
	before := requests.Load()
	code := runCmd([]string{"--category", "ai-language", "--quick", "--json", path,
		"--provider", "openai", "--product", "api", "--plan", "another-model", "--region", "global"})
	if code != 2 || requests.Load() != before {
		t.Errorf("a wrong plan exited %d after %d requests", code, requests.Load()-before)
	}
	t.Setenv("PB_AI_MODEL", "")
	if code := runCmd([]string{"--category", "ai-language", "--quick", "--json", path}); code != 2 || requests.Load() != before {
		t.Errorf("a missing model exited %d after %d requests", code, requests.Load()-before)
	}
}
