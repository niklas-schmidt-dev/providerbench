package tests

import (
	"context"
	"fmt"
	"io"
	"net/http"
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

func (netTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("network")
	client := &http.Client{Timeout: 60 * time.Second}
	defer client.CloseIdleConnections()

	// --- Latency: small requests on a warm connection ≈ RTT to the edge ---
	opts.Logf("network: latency to Cloudflare edge...")
	colo := ""
	var latencies []float64
	for i := range 9 {
		t := time.Now()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, speedBase+"/__down?bytes=0", nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("network: reach %s: %w", speedBase, err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if i == 0 {
			colo = resp.Header.Get("cf-meta-colo") // first request warms the connection
			continue
		}
		latencies = append(latencies, float64(time.Since(t).Microseconds())/1000)
	}

	// --- Download ---
	dlBytes := int64(200 << 20)
	if opts.Quick {
		dlBytes = 25 << 20
	}
	opts.Logf("network: downloading %d MiB...", dlBytes>>20)
	dlCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, fmt.Sprintf("%s/__down?bytes=%d", speedBase, dlBytes), nil)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network: download: %w", err)
	}
	got, _ := io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	dlMbps := float64(got) * 8 / time.Since(start).Seconds() / 1e6

	// --- Upload ---
	ulBytes := int64(50 << 20)
	if opts.Quick {
		ulBytes = 10 << 20
	}
	opts.Logf("network: uploading %d MiB...", ulBytes>>20)
	ulCtx, cancel2 := context.WithTimeout(ctx, 45*time.Second)
	defer cancel2()
	req, err = http.NewRequestWithContext(ulCtx, http.MethodPost, speedBase+"/__up", io.LimitReader(zeroReader{}, ulBytes))
	if err != nil {
		return nil, err
	}
	req.ContentLength = ulBytes
	start = time.Now()
	resp, err = client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network: upload: %w", err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	ulMbps := float64(ulBytes) * 8 / time.Since(start).Seconds() / 1e6

	res.Add("latency_p50", median(latencies), "ms", false)
	res.Add("download", dlMbps, "Mbps", true)
	res.Add("upload", ulMbps, "Mbps", true)
	if colo != "" {
		res.Note("measured against Cloudflare edge %s", colo)
	} else {
		res.Note("measured against the nearest Cloudflare edge")
	}
	finish(res)
	return res, ctx.Err()
}

// zeroReader is an infinite stream of zero bytes for upload tests.
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}
