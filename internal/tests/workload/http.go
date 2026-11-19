package workload

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

func init() { bench.Register(httpTest{}) }

// httpTest serves and consumes HTTP/1.1 over loopback TCP. Unlike the pure
// compute kernels this crosses the kernel on every request, so it also shows
// what the platform's network stack, syscalls and scheduler cost.
type httpTest struct{}

func (httpTest) Name() string     { return "http" }
func (httpTest) Category() string { return Category }
func (httpTest) Description() string {
	return "HTTP/1.1 requests over loopback TCP: throughput and latency with every core busy"
}

const httpBodySize = 1024

func (httpTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("http")
	body := textCorpus(httpBodySize)

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("http: listen on loopback: %w", err)
	}
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			w.Write(body)
		}),
	}
	go server.Serve(listener)
	defer server.Close()
	url := "http://" + listener.Addr().String() + "/"

	connections := 2 * kit.Parallelism()
	d := opts.Pick(4*time.Second, 1500*time.Millisecond)
	if phaseOverride > 0 {
		d = phaseOverride
	}
	opts.Logf("http: %d keep-alive connections over loopback (%s)...", connections, d)

	type workerResult struct {
		latencies []float64
		err       error
	}
	results := make([]workerResult, connections)
	clients := make([]*http.Client, connections)
	for i := range clients {
		transport := &http.Transport{MaxIdleConnsPerHost: 1, DisableCompression: true}
		defer transport.CloseIdleConnections()
		clients[i] = &http.Client{Transport: transport, Timeout: 10 * time.Second}
	}
	get := func(client *http.Client, buf []byte) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		resp, err := client.Do(req)
		if err != nil {
			return err
		}
		n, err := io.ReadFull(resp.Body, buf)
		resp.Body.Close()
		if err != nil {
			return err
		}
		if resp.StatusCode != http.StatusOK || n != httpBodySize {
			return fmt.Errorf("unexpected response: %s, %d bytes", resp.Status, n)
		}
		return nil
	}
	// Open every connection before the clock starts.
	for _, client := range clients {
		if err := get(client, make([]byte, httpBodySize)); err != nil {
			return nil, fmt.Errorf("http: warm-up request: %w", err)
		}
	}

	var wg sync.WaitGroup
	start := time.Now()
	deadline := start.Add(d)
	for i, client := range clients {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, httpBodySize)
			latencies := make([]float64, 0, 1<<16)
			for ctx.Err() == nil {
				began := time.Now()
				if !began.Before(deadline) {
					break
				}
				if err := get(client, buf); err != nil {
					results[i].err = err
					return
				}
				latencies = append(latencies, kit.Us(time.Since(began)))
			}
			results[i].latencies = latencies
		}()
	}
	wg.Wait()
	elapsed := time.Since(start).Seconds()

	var all []float64
	for _, r := range results {
		if r.err != nil {
			return nil, fmt.Errorf("http: request: %w", r.err)
		}
		all = append(all, r.latencies...)
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	if len(all) == 0 || elapsed <= 0 {
		return nil, errors.New("http: no request completed")
	}

	res.Add("requests", float64(len(all))/elapsed, "req/s", true)
	res.Add("latency_p50", kit.Percentile(all, 50), "us", false)
	res.Add("latency_p99", kit.Percentile(all, 99), "us", false)
	res.Note("client and server share this machine: %d keep-alive connections, %d-byte responses, loopback TCP", connections, httpBodySize)
	res.Finish()
	return res, ctx.Err()
}
