package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// stop says why a reply ended.
type stop string

const (
	stopEnd     stop = "end"
	stopLimit   stop = "limit"   // the output limit cut the reply off
	stopRefusal stop = "refusal" // the model or a filter declined
	stopOther   stop = "other"
)

type reply struct {
	text string
	stop stop
	// model is the model the endpoint says answered. An alias resolves to a
	// dated name here, and a gateway can serve another model altogether.
	model        string
	inputTokens  int
	outputTokens int
}

// client sends one problem as a single user message with no system prompt,
// so every model and every language gets exactly the same conversation.
type client interface {
	ask(ctx context.Context, prompt string) (reply, error)
}

const (
	// requestTimeout is set on every request. The Anthropic SDK also needs
	// it: without an explicit timeout it refuses a request whose output limit
	// could take longer than ten minutes to fill unless the reply is streamed.
	requestTimeout = 10 * time.Minute
	// maxRetries covers rate limits and overload. A request that still fails
	// ends the test: an unanswered problem is not a wrong answer.
	maxRetries = 5
)

func newClient(t *Target) client {
	// A redirect is not followed: it would carry the credentials to an
	// address nobody configured.
	transport := &http.Client{
		Timeout:       requestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	var inner client = &openAIClient{target: t, http: transport}
	if t.API == apiAnthropic {
		inner = &anthropicClient{
			target: t,
			// The address is given explicitly, so requests go where the
			// report says they went: the SDK would otherwise also take one
			// from a configuration profile.
			sdk: anthropic.NewClient(
				option.WithBaseURL(t.baseURL),
				option.WithHTTPClient(transport),
				option.WithMaxRetries(maxRetries),
				option.WithRequestTimeout(requestTimeout),
			),
		}
	}
	return &discreetClient{client: inner, target: t}
}

// discreetClient keeps credentials out of error messages. An endpoint can
// echo the key it was sent, and an error is printed and stored in the report.
type discreetClient struct {
	client
	target *Target
}

func (c *discreetClient) ask(ctx context.Context, prompt string) (reply, error) {
	out, err := c.client.ask(ctx, prompt)
	if err == nil {
		return out, nil
	}
	if text := err.Error(); c.target.redact(text) != text {
		err = errors.New(c.target.redact(text))
	}
	return out, err
}

// anthropicClient talks to the Messages API through the official SDK, which
// also resolves the credentials (ANTHROPIC_API_KEY and its alternatives).
//
// Thinking is left at the model's default and steered with effort only. The
// refusal fallback is deliberately off: it would let another model answer,
// and the report would then describe a model it did not measure. A refusal
// is a problem the model did not solve.
type anthropicClient struct {
	target *Target
	sdk    anthropic.Client
}

func (c *anthropicClient) ask(ctx context.Context, prompt string) (reply, error) {
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(c.target.Model),
		MaxTokens: int64(c.target.MaxTokens),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
		},
	}
	if c.target.Effort != "" {
		params.OutputConfig = anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffort(c.target.Effort)}
	}
	var response *http.Response
	message, err := c.sdk.Messages.New(ctx, params, option.WithResponseInto(&response))
	if err != nil {
		return reply{}, err
	}
	// The SDK reads any body below 400 as a reply, a redirect included.
	if response != nil && response.StatusCode/100 != 2 {
		return reply{}, fmt.Errorf("%s answered %s", c.target.Endpoint, response.Status)
	}
	out := reply{
		stop:         stopOther,
		model:        string(message.Model),
		inputTokens:  int(message.Usage.InputTokens),
		outputTokens: int(message.Usage.OutputTokens),
	}
	switch message.StopReason {
	case anthropic.StopReasonEndTurn, anthropic.StopReasonStopSequence:
		out.stop = stopEnd
	case anthropic.StopReasonMaxTokens:
		out.stop = stopLimit
	case anthropic.StopReasonRefusal:
		out.stop = stopRefusal
	}
	for _, block := range message.Content {
		if text, ok := block.AsAny().(anthropic.TextBlock); ok {
			out.text += text.Text
		}
	}
	return out, nil
}

// openAIClient talks to any endpoint that implements the chat completions
// API: OpenAI itself, gateways in front of other vendors, and local servers.
type openAIClient struct {
	target *Target
	http   *http.Client
	// backoff is the first retry delay; tests shorten it.
	backoff time.Duration
}

type chatRequest struct {
	Model               string        `json:"model"`
	Messages            []chatMessage `json:"messages"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	ReasoningEffort     string        `json:"reasoning_effort,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		Message struct {
			// Content is null when the model refuses.
			Content *string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

func (c *openAIClient) ask(ctx context.Context, prompt string) (reply, error) {
	body, err := json.Marshal(chatRequest{
		Model:               c.target.Model,
		Messages:            []chatMessage{{Role: "user", Content: prompt}},
		MaxCompletionTokens: c.target.MaxTokens,
		ReasoningEffort:     c.target.Effort,
	})
	if err != nil {
		return reply{}, err
	}
	delay := c.backoff
	if delay == 0 {
		delay = time.Second
	}
	for attempt := 0; ; attempt++ {
		out, wait, err := c.send(ctx, body)
		if err == nil {
			return out, nil
		}
		if wait < 0 || attempt == maxRetries {
			return reply{}, err
		}
		if wait == 0 {
			wait = delay << attempt
		}
		select {
		case <-ctx.Done():
			return reply{}, ctx.Err()
		case <-time.After(wait):
		}
	}
}

// send makes one attempt. On failure wait says how to go on: negative means
// the request will not succeed as it is, zero means retry after the usual
// delay, anything else is the delay the server asked for.
func (c *openAIClient) send(ctx context.Context, body []byte) (out reply, wait time.Duration, err error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.target.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return reply{}, -1, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.target.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+c.target.apiKey)
	}
	response, err := c.http.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return reply{}, -1, ctx.Err()
		}
		return reply{}, 0, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return reply{}, 0, err
	}
	if response.StatusCode != http.StatusOK {
		// Cleaned before it is shortened: half a credential would no longer
		// be recognised afterwards.
		err := fmt.Errorf("%s answered %s: %s", c.target.Endpoint, response.Status, excerpt(c.target.redact(string(data))))
		switch code := response.StatusCode; {
		case code == http.StatusTooManyRequests, code == http.StatusRequestTimeout, code == http.StatusConflict, code >= 500:
			seconds, _ := strconv.Atoi(response.Header.Get("Retry-After"))
			return reply{}, time.Duration(seconds) * time.Second, err
		}
		return reply{}, -1, err
	}
	var parsed chatResponse
	if err := json.Unmarshal(data, &parsed); err != nil {
		return reply{}, -1, fmt.Errorf("%s sent a reply that is not a chat completion: %w", c.target.Endpoint, err)
	}
	if len(parsed.Choices) == 0 {
		return reply{}, -1, fmt.Errorf("%s sent a chat completion without choices", c.target.Endpoint)
	}
	choice := parsed.Choices[0]
	out = reply{
		stop:         stopOther,
		model:        parsed.Model,
		inputTokens:  parsed.Usage.PromptTokens,
		outputTokens: parsed.Usage.CompletionTokens,
	}
	if choice.Message.Content != nil {
		out.text = *choice.Message.Content
	}
	switch choice.FinishReason {
	case "stop":
		out.stop = stopEnd
	case "length":
		out.stop = stopLimit
	case "content_filter":
		out.stop = stopRefusal
	}
	return out, 0, nil
}

// excerpt keeps an error body short enough for one line of output.
func excerpt(body string) string {
	text := []rune(strings.Join(strings.Fields(body), " "))
	if len(text) > 300 {
		return string(text[:300]) + "…"
	}
	return string(text)
}
