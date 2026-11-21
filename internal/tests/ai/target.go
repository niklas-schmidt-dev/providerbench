package ai

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Target is the model a run measures. It is read from the environment, like
// the storage suite's endpoint: credentials must never appear in flags,
// reports or shell history. See `providerbench help` for the variables.
type Target struct {
	API         string // "anthropic" or "openai"
	Model       string
	Endpoint    string // host the requests go to; recorded in the report
	Effort      string // reasoning effort, empty for the provider's default
	MaxTokens   int    // output limit per answer; zero leaves it to the provider
	Concurrency int

	baseURL    string // API root
	apiKey     string // openai: bearer token, may be empty for a local server
	transcript string // file every exchange is appended to, may be empty
}

const (
	apiAnthropic = "anthropic"
	apiOpenAI    = "openai"

	anthropicBaseURL = "https://api.anthropic.com"
	openAIBaseURL    = "https://api.openai.com/v1"

	// anthropicMaxTokens is the default output limit of the Messages API,
	// which has no default of its own. It covers thinking and the answer.
	anthropicMaxTokens = 32000
	defaultConcurrency = 4
)

// LoadTarget reads the PB_AI_* variables.
func LoadTarget() (*Target, error) {
	get := func(name string) string { return strings.TrimSpace(os.Getenv(name)) }
	t := &Target{
		API:         strings.ToLower(get("PB_AI_API")),
		Model:       get("PB_AI_MODEL"),
		Effort:      get("PB_AI_EFFORT"),
		Concurrency: defaultConcurrency,
		transcript:  get("PB_AI_TRANSCRIPT"),
	}
	if t.API != apiAnthropic && t.API != apiOpenAI {
		return nil, fmt.Errorf("ai: PB_AI_API must be %q (Claude models) or %q (any OpenAI-compatible endpoint) — ai-language runs also need PB_AI_MODEL", apiAnthropic, apiOpenAI)
	}
	if t.Model == "" {
		return nil, fmt.Errorf("ai: PB_AI_MODEL is not set — name the model to measure, e.g. claude-opus-5-5")
	}

	base := anthropicBaseURL
	switch t.API {
	case apiAnthropic:
		// The SDK resolves the credentials itself. The address is read here,
		// recorded in the report and handed to the SDK.
		if v := get("ANTHROPIC_BASE_URL"); v != "" {
			base = v
		}
		t.MaxTokens = anthropicMaxTokens
	case apiOpenAI:
		base = openAIBaseURL
		if v := get("PB_AI_BASE_URL"); v != "" {
			base = strings.TrimRight(v, "/")
		}
		t.apiKey = get("PB_AI_API_KEY")
		// An OpenAI key is only ever sent to OpenAI: with another base URL
		// it would be handed to a third party.
		if t.apiKey == "" && base == openAIBaseURL {
			t.apiKey = get("OPENAI_API_KEY")
		}
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" || parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("ai: the API address %q is not an http(s) URL", base)
	}
	t.baseURL = base
	t.Endpoint = parsed.Host

	number := func(name string, into *int) error {
		v := get(name)
		if v == "" {
			return nil
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return fmt.Errorf("ai: %s must be a whole number above zero", name)
		}
		*into = n
		return nil
	}
	if err := number("PB_AI_MAX_TOKENS", &t.MaxTokens); err != nil {
		return nil, err
	}
	if err := number("PB_AI_CONCURRENCY", &t.Concurrency); err != nil {
		return nil, err
	}
	return t, nil
}

// redact removes the credentials a request may carry from text, as far as
// they are known here. Anything shorter than eight characters is a
// placeholder for a local server, not a secret.
func (t *Target) redact(text string) string {
	for _, v := range []string{t.apiKey, os.Getenv("ANTHROPIC_API_KEY"), os.Getenv("ANTHROPIC_AUTH_TOKEN")} {
		if v = strings.TrimSpace(v); len(v) >= 8 {
			text = strings.ReplaceAll(text, v, "[credential]")
		}
	}
	return text
}

// Identity names what a report measured when the user gave no identity
// flags: the model is the plan, the party serving it the provider.
func (t *Target) Identity() (provider, product, plan, region string) {
	provider = t.API
	if t.API == apiOpenAI && t.baseURL != openAIBaseURL {
		provider = t.Endpoint // a third party or a local server
	}
	return provider, "api", t.Model, "global"
}

// Environment is the part of the method that belongs to this run. It goes
// into the report so that two runs of one model under different settings are
// never read as the same measurement.
func (t *Target) Environment() map[string]string {
	env := map[string]string{
		"ai_api":        t.API,
		"ai_endpoint":   t.Endpoint,
		"ai_effort":     "provider default",
		"ai_max_tokens": "provider default",
		// No sampling parameter is sent: current models reject them.
		"ai_sampling": "provider default",
	}
	if t.Effort != "" {
		env["ai_effort"] = t.Effort
	}
	if t.MaxTokens > 0 {
		env["ai_max_tokens"] = strconv.Itoa(t.MaxTokens)
	}
	return env
}
