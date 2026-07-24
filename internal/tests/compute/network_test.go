package compute

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestServerDurationMs(t *testing.T) {
	tests := []struct {
		name   string
		values []string
		want   float64
		ok     bool
	}{
		{
			name:   "legacy full metric",
			values: []string{"cfRequestDuration;dur=32.999992"},
			want:   32.999992,
			ok:     true,
		},
		{
			name:   "legacy abbreviated metric",
			values: []string{"cfReqDur; dur=12.5"},
			want:   12.5,
			ok:     true,
		},
		{
			name:   "current split metrics",
			values: []string{"cfSpeedEdge;dur=3, cfSpeedWorker;dur=22"},
			want:   25,
			ok:     true,
		},
		{
			name:   "current metrics across header lines",
			values: []string{"cfSpeedEdge;dur=3", "cfSpeedWorker;dur=22, cfL4;dur=500"},
			want:   25,
			ok:     true,
		},
		{
			name:   "legacy metric takes precedence",
			values: []string{"cfSpeedEdge;dur=3, cfRequestDuration;dur=9, cfSpeedWorker;dur=22"},
			want:   9,
			ok:     true,
		},
		{
			name:   "missing supported metric",
			values: []string{`cfL4;desc="transport"`},
			ok:     false,
		},
		{
			name:   "malformed duration",
			values: []string{"cfSpeedEdge;dur=nope"},
			ok:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			header := make(http.Header)
			for _, value := range tt.values {
				header.Add("Server-Timing", value)
			}
			got, ok := serverDurationMs(header)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("serverDurationMs() = (%v, %v), want (%v, %v)", got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestDoTimedRequestRetriesRateLimit(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		if requests == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	timed, err := doTimedRequest(context.Background(), server.Client(), func() (*http.Request, error) {
		return http.NewRequest(http.MethodGet, server.URL, nil)
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer timed.Response.Body.Close()
	if timed.Response.StatusCode != http.StatusOK {
		t.Fatalf("status = %s, want 200 OK", timed.Response.Status)
	}
	if requests != 2 || timed.RateLimitRetries != 1 {
		t.Fatalf("requests/retries = %d/%d, want 2/1", requests, timed.RateLimitRetries)
	}
}

func TestRateLimitDelay(t *testing.T) {
	if got := rateLimitDelay("7", 0); got != 7*time.Second {
		t.Fatalf("numeric Retry-After = %s, want 7s", got)
	}
	future := time.Now().Add(2 * time.Minute).UTC().Format(http.TimeFormat)
	if got := rateLimitDelay(future, 0); got < 59*time.Second || got > time.Minute {
		t.Fatalf("HTTP-date Retry-After = %s, want capped near 1m", got)
	}
	if got := rateLimitDelay("", 2); got != 20*time.Second {
		t.Fatalf("fallback delay = %s, want 20s", got)
	}
}
