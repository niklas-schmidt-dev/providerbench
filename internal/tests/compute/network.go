package compute

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(netTest{}) }

type netTest struct{}

func (netTest) Name() string { return "network" }
func (netTest) Description() string {
	return "Latency, download and upload throughput against the nearest Cloudflare edge"
}

const speedBase = "https://speed.cloudflare.com"

const maxRateLimitRetries = 4

type timedResponse struct {
	Response         *http.Response
	AttemptDuration  time.Duration
	ExcludedDuration time.Duration
	RateLimitRetries int
}

func (netTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("network")
	client := &http.Client{Timeout: 60 * time.Second}
	defer client.CloseIdleConnections()
	rateLimitRetries := 0

	// --- Latency: small requests on a warm connection ≈ RTT to the edge.
	// The endpoint spends tens of ms of server time per request, so the raw
	// round trip would drown the network in server processing. Cloudflare
	// reports that share via Server-Timing; subtract it, as Cloudflare's own
	// speed test does. ---
	opts.Logf("network: latency to Cloudflare edge...")
	colo := ""
	subtracted := 0
	var latencies []float64
	for i := range 9 {
		timed, err := doTimedRequest(ctx, client, func() (*http.Request, error) {
			return http.NewRequestWithContext(ctx, http.MethodGet, speedBase+"/__down?bytes=0", nil)
		}, opts.Logf)
		if err != nil {
			return nil, fmt.Errorf("network: reach %s: %w", speedBase, err)
		}
		rateLimitRetries += timed.RateLimitRetries
		resp := timed.Response
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("network: latency: unexpected status %s", resp.Status)
		}
		if i == 0 {
			colo = resp.Header.Get("cf-meta-colo") // first request warms the connection
			if colo == "" {
				colo = resp.Header.Get("colo")
			}
			continue
		}
		total := float64(timed.AttemptDuration.Microseconds()) / 1000
		if serverMs, ok := serverDurationMs(resp.Header); ok {
			total = max(0, total-serverMs)
			subtracted++
		}
		latencies = append(latencies, total)
	}
	if subtracted != len(latencies) {
		return nil, fmt.Errorf(
			"network: Cloudflare Server-Timing missing on %d of %d latency requests; refusing to mix latency methodologies",
			len(latencies)-subtracted,
			len(latencies),
		)
	}

	// --- Download: repeated bounded chunks, so no single request can hit
	// endpoint size limits, and slow links still finish in bounded time ---
	chunk := int64(50 << 20)
	maxChunks := 4
	if opts.Quick {
		chunk = 25 << 20
		maxChunks = 1
	}
	opts.Logf("network: downloading up to %d MiB...", chunk*int64(maxChunks)>>20)
	dlCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	var got int64
	start := time.Now()
	var excludedDownloadTime time.Duration
	for i := 0; i < maxChunks && dlCtx.Err() == nil && time.Since(start) < 10*time.Second; i++ {
		timed, err := doTimedRequest(dlCtx, client, func() (*http.Request, error) {
			return http.NewRequestWithContext(dlCtx, http.MethodGet, fmt.Sprintf("%s/__down?bytes=%d", speedBase, chunk), nil)
		}, opts.Logf)
		if err != nil {
			return nil, fmt.Errorf("network: download: %w", err)
		}
		rateLimitRetries += timed.RateLimitRetries
		excludedDownloadTime += timed.ExcludedDuration
		resp := timed.Response
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("network: download: unexpected status %s", resp.Status)
		}
		n, err := io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		got += n
		if err != nil {
			break // count what we transferred before the connection died
		}
	}
	if got == 0 {
		return nil, fmt.Errorf("network: download transferred 0 bytes")
	}
	downloadDuration := time.Since(start) - excludedDownloadTime
	if downloadDuration <= 0 {
		return nil, fmt.Errorf("network: invalid download duration after excluding rate-limit retries")
	}
	dlMbps := float64(got) * 8 / downloadDuration.Seconds() / 1e6

	// --- Upload ---
	ulBytes := int64(50 << 20)
	if opts.Quick {
		ulBytes = 10 << 20
	}
	opts.Logf("network: uploading %d MiB...", ulBytes>>20)
	ulCtx, cancel2 := context.WithTimeout(ctx, 45*time.Second)
	defer cancel2()
	timed, err := doTimedRequest(ulCtx, client, func() (*http.Request, error) {
		req, reqErr := http.NewRequestWithContext(ulCtx, http.MethodPost, speedBase+"/__up", io.LimitReader(zeroReader{}, ulBytes))
		if reqErr == nil {
			req.ContentLength = ulBytes
		}
		return req, reqErr
	}, opts.Logf)
	if err != nil {
		return nil, fmt.Errorf("network: upload: %w", err)
	}
	rateLimitRetries += timed.RateLimitRetries
	ulResp := timed.Response
	io.Copy(io.Discard, ulResp.Body)
	ulResp.Body.Close()
	if ulResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("network: upload: unexpected status %s", ulResp.Status)
	}
	if timed.AttemptDuration <= 0 {
		return nil, fmt.Errorf("network: invalid upload duration")
	}
	ulMbps := float64(ulBytes) * 8 / timed.AttemptDuration.Seconds() / 1e6

	res.Add("latency_p50", median(latencies), "ms", false)
	res.Add("download", dlMbps, "Mbps", true)
	res.Add("upload", ulMbps, "Mbps", true)
	if colo != "" {
		res.Note("measured against Cloudflare edge %s", colo)
	} else {
		res.Note("measured against the nearest Cloudflare edge")
	}
	res.Note("latency excludes server processing time (Cloudflare Server-Timing)")
	if rateLimitRetries > 0 {
		res.Note("Cloudflare rate-limit retries: %d (retry time excluded from metrics)", rateLimitRetries)
	}
	finish(res)
	return res, ctx.Err()
}

// doTimedRequest retries HTTP 429 responses without letting the rejected
// attempt or backoff contaminate a latency or throughput metric.
func doTimedRequest(
	ctx context.Context,
	client *http.Client,
	newRequest func() (*http.Request, error),
	logf func(string, ...any),
) (*timedResponse, error) {
	result := &timedResponse{}
	for attempt := 0; ; attempt++ {
		req, err := newRequest()
		if err != nil {
			return nil, err
		}
		started := time.Now()
		resp, err := client.Do(req)
		result.AttemptDuration = time.Since(started)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusTooManyRequests || attempt >= maxRateLimitRetries {
			result.Response = resp
			return result, nil
		}

		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		rejectedDuration := time.Since(started)
		delay := rateLimitDelay(resp.Header.Get("Retry-After"), attempt)
		result.ExcludedDuration += rejectedDuration + delay
		result.RateLimitRetries++
		if logf != nil {
			logf("network: Cloudflare rate limited the request; retrying in %s...", delay)
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func rateLimitDelay(retryAfter string, attempt int) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds >= 0 {
		return min(time.Duration(seconds)*time.Second, time.Minute)
	}
	if when, err := http.ParseTime(retryAfter); err == nil {
		return min(max(0, time.Until(when)), time.Minute)
	}
	return min(5*time.Second<<attempt, time.Minute)
}

// serverDurationMs extracts Cloudflare's server-side processing time using the
// same compatibility rules as Cloudflare's official speed-test engine. Older
// responses expose one cfReq*Duration metric; current responses split the time
// across cfSpeed* metrics, which must be summed.
func serverDurationMs(header http.Header) (float64, bool) {
	var speedTotal float64
	for _, value := range header.Values("Server-Timing") {
		for entry := range strings.SplitSeq(value, ",") {
			entry = strings.TrimSpace(entry)
			name, _, _ := strings.Cut(entry, ";")
			name = strings.ToLower(strings.TrimSpace(name))
			isLegacy := name == "cfreqdur" ||
				name == "cfrequestdur" ||
				name == "cfreqduration" ||
				name == "cfrequestduration"
			isCurrent := strings.HasPrefix(name, "cfspeed")
			if !isLegacy && !isCurrent {
				continue
			}
			for field := range strings.SplitSeq(entry, ";") {
				if raw, ok := strings.CutPrefix(strings.TrimSpace(field), "dur="); ok {
					ms, err := strconv.ParseFloat(raw, 64)
					if err != nil || ms <= 0 {
						break
					}
					if isLegacy {
						return ms, true
					}
					speedTotal += ms
					break
				}
			}
		}
	}
	return speedTotal, speedTotal > 0
}

// zeroReader is an infinite stream of zero bytes for upload tests.
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}
