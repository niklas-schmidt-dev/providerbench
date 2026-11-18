// Package storage contains the object-storage benchmarks. The suite drives
// any S3-compatible endpoint (S3, R2, B2, GCS interop, MinIO, ...) through
// the plain HTTP API, so every provider runs the identical workload.
package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(s3Test{}) }

type s3Test struct{}

func (s3Test) Name() string     { return "s3" }
func (s3Test) Category() string { return "storage" }
func (s3Test) Description() string {
	return "Object storage: TTFB, throughput and small-object latency against an S3-compatible endpoint"
}

const (
	smallObjectSize = 16 << 10
	largeObjectSize = 64 << 20
	quickLargeSize  = 16 << 20
	smallSamples    = 40
	quickSamples    = 12
	listSamples     = 9
)

// config is read from the environment only: credentials must never appear in
// flags, reports or shell history. See `providerbench help` for the variables.
type config struct {
	endpoint  *url.URL
	bucket    string
	prefix    string
	pathStyle bool
	sig       signer
}

func loadConfig() (*config, error) {
	need := func(name string) (string, error) {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v, nil
		}
		return "", fmt.Errorf(
			"s3: %s is not set — storage runs need PB_S3_ENDPOINT, PB_S3_BUCKET, PB_S3_ACCESS_KEY and PB_S3_SECRET_KEY",
			name,
		)
	}
	rawEndpoint, err := need("PB_S3_ENDPOINT")
	if err != nil {
		return nil, err
	}
	bucket, err := need("PB_S3_BUCKET")
	if err != nil {
		return nil, err
	}
	accessKey, err := need("PB_S3_ACCESS_KEY")
	if err != nil {
		return nil, err
	}
	secretKey, err := need("PB_S3_SECRET_KEY")
	if err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(rawEndpoint)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("s3: PB_S3_ENDPOINT must be an http(s) URL, e.g. https://s3.eu-central-1.amazonaws.com")
	}
	if endpoint.Path != "" && endpoint.Path != "/" {
		return nil, fmt.Errorf("s3: PB_S3_ENDPOINT must not contain a path; the bucket comes from PB_S3_BUCKET")
	}
	region := strings.TrimSpace(os.Getenv("PB_S3_REGION"))
	if region == "" {
		region = "us-east-1"
	}
	prefix := strings.TrimSpace(os.Getenv("PB_S3_PREFIX"))
	if prefix == "" {
		prefix = "providerbench"
	}
	pathStyle := true
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PB_S3_PATH_STYLE"))) {
	case "0", "false", "no":
		pathStyle = false
	}
	return &config{
		endpoint:  endpoint,
		bucket:    bucket,
		prefix:    strings.Trim(prefix, "/"),
		pathStyle: pathStyle,
		sig:       signer{accessKey: accessKey, secretKey: secretKey, region: region},
	}, nil
}

// objectURL addresses one key, path-style by default (the widest-compatible
// form) or virtual-hosted when PB_S3_PATH_STYLE=false.
func (c *config) objectURL(key string) string {
	if c.pathStyle {
		return c.endpoint.Scheme + "://" + c.endpoint.Host + "/" + c.bucket + "/" + key
	}
	return c.endpoint.Scheme + "://" + c.bucket + "." + c.endpoint.Host + "/" + key
}

func (c *config) listURL(prefix string) string {
	query := url.Values{"list-type": {"2"}, "prefix": {prefix}}
	base := c.endpoint.Scheme + "://" + c.endpoint.Host + "/" + c.bucket
	if !c.pathStyle {
		base = c.endpoint.Scheme + "://" + c.bucket + "." + c.endpoint.Host
	}
	return base + "/?" + query.Encode()
}

func (s3Test) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	cfg, err := loadConfig()
	if err != nil {
		return nil, err
	}
	res := newResult("s3")
	client := &http.Client{Timeout: 180 * time.Second}
	defer client.CloseIdleConnections()

	samples := smallSamples
	largeSize := largeObjectSize
	if opts.Quick {
		samples = quickSamples
		largeSize = quickLargeSize
	}

	// Unique run prefix: concurrent runs never collide, and cleanup can only
	// ever touch keys this run created.
	runID := make([]byte, 6)
	if _, err := rand.Read(runID); err != nil {
		return nil, fmt.Errorf("s3: random run id: %w", err)
	}
	keyPrefix := cfg.prefix + "/" + hex.EncodeToString(runID)
	var created []string
	defer func() { // best-effort cleanup even when the run is interrupted
		cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
		defer cancel()
		failed := 0
		for _, key := range created {
			if err := s3Delete(cleanupCtx, client, cfg, key); err != nil {
				failed++
			}
		}
		if failed > 0 {
			res.Note("cleanup: %d of %d objects could not be deleted under %s/", failed, len(created), keyPrefix)
		}
	}()

	// --- Reachability: one untimed small PUT surfaces credential, bucket and
	// permission problems before any metric exists. ---
	opts.Logf("s3: verifying endpoint access...")
	warmKey := keyPrefix + "/warmup"
	if err := s3Put(ctx, client, cfg, warmKey, payload(smallObjectSize)); err != nil {
		return nil, fmt.Errorf("s3: endpoint check failed: %w", err)
	}
	created = append(created, warmKey)

	// --- Small-object writes: the latency of persisting 16 KiB, the shape of
	// metadata-heavy workloads. Unique-stamped payloads defeat dedup. ---
	opts.Logf("s3: %d small-object writes (16 KiB)...", samples)
	putTimes := make([]float64, 0, samples)
	smallKeys := make([]string, 0, samples)
	for i := range samples {
		key := fmt.Sprintf("%s/small-%03d", keyPrefix, i)
		body := payload(smallObjectSize)
		start := time.Now()
		if err := s3Put(ctx, client, cfg, key, body); err != nil {
			return nil, fmt.Errorf("s3: small put %d: %w", i, err)
		}
		putTimes = append(putTimes, ms(time.Since(start)))
		created = append(created, key)
		smallKeys = append(smallKeys, key)
	}

	// --- Small-object reads: TTFB is the time until the first payload byte;
	// the total includes draining all 16 KiB. Connections are warm. ---
	opts.Logf("s3: %d small-object reads...", samples)
	getTimes := make([]float64, 0, samples)
	ttfbs := make([]float64, 0, samples)
	for i, key := range smallKeys {
		ttfb, total, err := s3GetTimed(ctx, client, cfg, key)
		if err != nil {
			return nil, fmt.Errorf("s3: small get %d: %w", i, err)
		}
		ttfbs = append(ttfbs, ms(ttfb))
		getTimes = append(getTimes, ms(total))
	}

	// --- Throughput: one large object in a single PUT and a single GET. The
	// payload is pre-generated and incompressible; timing is transfer only. ---
	opts.Logf("s3: uploading %d MiB...", largeSize>>20)
	largeKey := keyPrefix + "/large"
	largeBody := payload(largeSize)
	start := time.Now()
	if err := s3Put(ctx, client, cfg, largeKey, largeBody); err != nil {
		return nil, fmt.Errorf("s3: large put: %w", err)
	}
	uploadSecs := time.Since(start).Seconds()
	created = append(created, largeKey)

	opts.Logf("s3: downloading %d MiB...", largeSize>>20)
	start = time.Now()
	n, err := s3GetDiscard(ctx, client, cfg, largeKey)
	if err != nil {
		return nil, fmt.Errorf("s3: large get: %w", err)
	}
	downloadSecs := time.Since(start).Seconds()
	if n != int64(largeSize) {
		return nil, fmt.Errorf("s3: large get returned %d bytes, want %d", n, largeSize)
	}

	// --- Listing: the operation every sync and backup tool hammers. ---
	opts.Logf("s3: %d list operations...", listSamples)
	listTimes := make([]float64, 0, listSamples)
	for i := range listSamples {
		start := time.Now()
		if err := s3List(ctx, client, cfg, keyPrefix+"/"); err != nil {
			return nil, fmt.Errorf("s3: list: %w", err)
		}
		if i == 0 {
			continue // first request warms the connection
		}
		listTimes = append(listTimes, ms(time.Since(start)))
	}

	res.Add("ttfb_p50", percentile(ttfbs, 50), "ms", false)
	res.Add("small_put_p50", percentile(putTimes, 50), "ms", false)
	res.Add("small_put_p99", percentile(putTimes, 99), "ms", false)
	res.Add("small_get_p50", percentile(getTimes, 50), "ms", false)
	res.Add("small_get_p99", percentile(getTimes, 99), "ms", false)
	res.Add("list_p50", percentile(listTimes, 50), "ms", false)
	res.Add("upload_throughput", float64(largeSize)/uploadSecs/1e6, "MB/s", true)
	res.Add("download_throughput", float64(largeSize)/downloadSecs/1e6, "MB/s", true)

	style := "path-style"
	if !cfg.pathStyle {
		style = "virtual-hosted"
	}
	res.Note("S3-compatible HTTP API · %s addressing · signing region %s", style, cfg.sig.region)
	res.Note("%d × 16 KiB small objects · %d MiB large object · incompressible unique-stamped payloads", samples, largeSize>>20)
	res.Note("TTFB is time to first payload byte on a warm connection · endpoint and bucket names are not recorded")
	finish(res)
	return res, ctx.Err()
}

// --- HTTP operations -------------------------------------------------------

func s3Put(ctx context.Context, client *http.Client, cfg *config, key string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, cfg.objectURL(key), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	cfg.sig.sign(req, unsignedPayload, time.Now())
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer drain(resp)
	return expectStatus(resp, http.StatusOK)
}

// s3GetTimed reads one object and returns time-to-first-byte and total time.
func s3GetTimed(ctx context.Context, client *http.Client, cfg *config, key string) (ttfb, total time.Duration, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.objectURL(key), nil)
	if err != nil {
		return 0, 0, err
	}
	cfg.sig.sign(req, emptyPayloadHash, time.Now())
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer drain(resp)
	if err := expectStatus(resp, http.StatusOK); err != nil {
		return 0, 0, err
	}
	one := make([]byte, 1)
	if _, err := io.ReadFull(resp.Body, one); err != nil {
		return 0, 0, fmt.Errorf("read first byte: %w", err)
	}
	ttfb = time.Since(start)
	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		return 0, 0, err
	}
	return ttfb, time.Since(start), nil
}

func s3GetDiscard(ctx context.Context, client *http.Client, cfg *config, key string) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.objectURL(key), nil)
	if err != nil {
		return 0, err
	}
	cfg.sig.sign(req, emptyPayloadHash, time.Now())
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer drain(resp)
	if err := expectStatus(resp, http.StatusOK); err != nil {
		return 0, err
	}
	return io.Copy(io.Discard, resp.Body)
}

func s3List(ctx context.Context, client *http.Client, cfg *config, prefix string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.listURL(prefix), nil)
	if err != nil {
		return err
	}
	cfg.sig.sign(req, emptyPayloadHash, time.Now())
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer drain(resp)
	return expectStatus(resp, http.StatusOK)
}

func s3Delete(ctx context.Context, client *http.Client, cfg *config, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, cfg.objectURL(key), nil)
	if err != nil {
		return err
	}
	cfg.sig.sign(req, emptyPayloadHash, time.Now())
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer drain(resp)
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return expectStatus(resp, http.StatusNoContent)
}

func drain(resp *http.Response) {
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// expectStatus reports non-2xx responses with the S3 error code when the body
// carries one — never the full body, which can echo bucket and key names.
func expectStatus(resp *http.Response, want int) error {
	if resp.StatusCode == want {
		return nil
	}
	code := s3ErrorCode(resp)
	if code != "" {
		return fmt.Errorf("unexpected status %s (%s)", resp.Status, code)
	}
	return fmt.Errorf("unexpected status %s", resp.Status)
}

func s3ErrorCode(resp *http.Response) string {
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return ""
	}
	text := string(body)
	start := strings.Index(text, "<Code>")
	end := strings.Index(text, "</Code>")
	if start < 0 || end < 0 || end <= start+len("<Code>") {
		return ""
	}
	return text[start+len("<Code>") : end]
}

// --- helpers ----------------------------------------------------------------

// payload returns size bytes of incompressible data: a fast xorshift stream
// seeded from crypto/rand, so neither compression nor dedup can flatter a
// provider.
func payload(size int) []byte {
	seed := make([]byte, 8)
	rand.Read(seed)
	state := binary.LittleEndian.Uint64(seed) | 1
	out := make([]byte, size)
	for i := 0; i+8 <= size; i += 8 {
		state ^= state << 13
		state ^= state >> 7
		state ^= state << 17
		binary.LittleEndian.PutUint64(out[i:], state)
	}
	return out
}

func ms(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000
}

// Options is an alias so test files read naturally.
type Options = bench.Options

func newResult(name string) *bench.Result {
	return &bench.Result{Test: name, StartedAt: time.Now().UTC()}
}

func finish(r *bench.Result) {
	r.DurationSeconds = round2(time.Since(r.StartedAt).Seconds())
	for i, m := range r.Metrics {
		r.Metrics[i].Value = round2(m.Value)
	}
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// percentile interpolates over a small sample, matching the compute suite.
func percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := make([]float64, len(xs))
	copy(sorted, xs)
	for i := 1; i < len(sorted); i++ { // insertion sort, samples are small
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	idx := p / 100 * float64(len(sorted)-1)
	lo := int(math.Floor(idx))
	hi := int(math.Ceil(idx))
	if lo == hi {
		return sorted[lo]
	}
	frac := idx - float64(lo)
	return sorted[lo]*(1-frac) + sorted[hi]*frac
}
