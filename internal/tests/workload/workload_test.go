package workload

import (
	"bytes"
	"compress/flate"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func shortPhases(t *testing.T) {
	t.Helper()
	phaseOverride = 40 * time.Millisecond
	t.Cleanup(func() { phaseOverride = 0 })
}

func metricsOf(res *bench.Result) map[string]bench.Metric {
	out := make(map[string]bench.Metric, len(res.Metrics))
	for _, m := range res.Metrics {
		out[m.Name] = m
	}
	return out
}

// The generated inputs are the workload definition: if these bytes change,
// the numbers change with them and the protocol must be bumped. The hashes
// are the same on every architecture because generation is integer-only.
func TestTextCorpusIsPinned(t *testing.T) {
	corpus := textCorpus(compressChunk)
	if len(corpus) != compressChunk {
		t.Fatalf("corpus is %d bytes, want %d", len(corpus), compressChunk)
	}
	sum := sha256.Sum256(corpus)
	const want = "b83deb1c1aef35b1810d74ecb39b589097fc11a46060f006d24f59e0ff46fa78"
	if got := hex.EncodeToString(sum[:]); got != want {
		t.Fatalf("text corpus changed: sha256 %s, want %s", got, want)
	}
}

func TestTextCorpusCompressesLikeText(t *testing.T) {
	corpus := textCorpus(compressChunk)
	var packed bytes.Buffer
	w, err := flate.NewWriter(&packed, flate.DefaultCompression)
	if err != nil {
		t.Fatal(err)
	}
	w.Write(corpus)
	w.Close()
	ratio := float64(len(corpus)) / float64(packed.Len())
	if ratio < 2 || ratio > 5 {
		t.Fatalf("corpus compresses %.2f:1; the kernel is meant to see text-like data (2:1 to 5:1)", ratio)
	}
}

func TestJSONDocumentIsPinnedAndRoundTrips(t *testing.T) {
	document := jsonDocument()
	if len(document) != jsonRecords {
		t.Fatalf("document has %d records, want %d", len(document), jsonRecords)
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(encoded)
	const want = "eee712fd4468c332a12c190cc2fd9673979321751993b808923a8478689aff0b"
	if got := hex.EncodeToString(sum[:]); got != want {
		t.Fatalf("JSON document changed: sha256 %s, want %s", got, want)
	}
	var decoded []jsonRecord
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(decoded, document) {
		t.Fatal("document does not survive a JSON round trip, so the kernel's self-check would fail")
	}
}

func TestBuildTreeHasTheAdvertisedSize(t *testing.T) {
	if got := buildTree(4, 1).count(); got != 31 {
		t.Fatalf("depth-4 tree has %d nodes, want 31", got)
	}
}

func TestHandshakeIsFullTLS13(t *testing.T) {
	server, client, err := tlsConfigs()
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := handshake(server, client); err != nil {
			t.Fatal(err)
		}
	}
	// A client that does not trust the certificate must fail, not be counted.
	_, stranger, err := tlsConfigs()
	if err != nil {
		t.Fatal(err)
	}
	if err := handshake(server, stranger); err == nil {
		t.Fatal("handshake with an untrusted certificate succeeded")
	}
}

func TestEveryWorkloadReportsItsContract(t *testing.T) {
	shortPhases(t)
	scaledUnits := map[string]string{
		"alloc": "Mobjects/s", "compress": "MB/s", "json": "MB/s",
		"kv": "Mops/s", "sort": "Mkeys/s", "tls": "handshakes/s",
	}
	suite := bench.Suite(Category, bench.StandardProfile)
	if len(suite) != len(scaledUnits)+1 {
		t.Fatalf("workload suite has %d tests, want %d", len(suite), len(scaledUnits)+1)
	}
	for _, b := range suite {
		t.Run(b.Name(), func(t *testing.T) {
			res, err := b.Run(context.Background(), bench.Options{Quick: true})
			if err != nil {
				t.Fatal(err)
			}
			if res.Test != b.Name() || res.StartedAt.IsZero() {
				t.Fatalf("result identity is incomplete: %+v", res)
			}
			metrics := metricsOf(res)
			if b.Name() == "http" {
				if m := metrics["requests"]; m.Unit != "req/s" || !m.HigherIsBetter || m.Value <= 0 {
					t.Errorf("requests metric is wrong: %+v", m)
				}
				for _, name := range []string{"latency_p50", "latency_p99"} {
					if m := metrics[name]; m.Unit != "us" || m.HigherIsBetter || m.Value <= 0 {
						t.Errorf("%s metric is wrong: %+v", name, m)
					}
				}
				if metrics["latency_p99"].Value < metrics["latency_p50"].Value {
					t.Error("p99 latency is below the median")
				}
				return
			}
			if len(metrics) != 2 {
				t.Fatalf("want single_core and multi_core, got %+v", res.Metrics)
			}
			for _, name := range []string{"single_core", "multi_core"} {
				m := metrics[name]
				if m.Unit != scaledUnits[b.Name()] || !m.HigherIsBetter || m.Value <= 0 {
					t.Errorf("%s metric is wrong: %+v", name, m)
				}
			}
		})
	}
}

func TestWorkloadFailsOnCancelledContext(t *testing.T) {
	shortPhases(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (sortTest{}).Run(ctx, bench.Options{Quick: true}); err == nil {
		t.Fatal("a cancelled run must not produce metrics")
	}
}
