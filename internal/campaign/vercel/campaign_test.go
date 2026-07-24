package vercel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

type fakeClient struct {
	events              []string
	lastArgs            map[string]string
	pricingDate         string
	removed             []string
	deleteContextsValid bool
	failBenchmark       bool
}

func (f *fakeClient) Preflight(context.Context) error {
	f.events = append(f.events, "preflight")
	return nil
}

func (f *fakeClient) Version(context.Context) (string, error) {
	f.events = append(f.events, "version")
	return "56.4.1", nil
}

func (f *fakeClient) Create(_ context.Context, opts CreateOptions) error {
	f.events = append(f.events, "create-"+opts.Name)
	return nil
}

func (f *fakeClient) CopyTo(_ context.Context, name, _, _ string) error {
	f.events = append(f.events, "copy-to-"+name)
	return nil
}

func (f *fakeClient) Exec(_ context.Context, name string, _ time.Duration, binary string, args []string) error {
	if binary == remoteBinary {
		f.events = append(f.events, "benchmark-"+name)
		if f.failBenchmark {
			return errors.New("benchmark failed")
		}
		f.lastArgs = parseArgs(args)
		f.pricingDate = envValue(args, "pricing_as_of")
	} else {
		f.events = append(f.events, "prepare-"+name)
	}
	return nil
}

func (f *fakeClient) CopyFrom(_ context.Context, name, _, local string) error {
	f.events = append(f.events, "copy-from-"+name)
	sample, _ := strconv.Atoi(f.lastArgs["--sample-index"])
	repeat, _ := strconv.Atoi(f.lastArgs["--repeat-index"])
	report := map[string]any{
		"created_at": time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC),
		"provider": map[string]any{
			"name":    "vercel",
			"product": "Sandbox",
			"plan":    f.lastArgs["--plan"],
			"region":  Region,
		},
		"measurement": map[string]any{
			"campaign_id":  f.lastArgs["--campaign"],
			"sample_index": sample,
			"repeat_index": repeat,
		},
		"environment": map[string]any{
			"pricing_as_of": f.pricingDate,
		},
		"results": []any{map[string]any{
			"test":       "cpu",
			"started_at": time.Date(2026, 7, 24, 12, 0, 1, 0, time.UTC),
		}},
	}
	data, err := json.Marshal(report)
	if err != nil {
		return err
	}
	return os.WriteFile(local, data, 0o644)
}

func (f *fakeClient) Remove(ctx context.Context, name string) error {
	f.events = append(f.events, "remove-"+name)
	f.removed = append(f.removed, name)
	f.deleteContextsValid = f.deleteContextsValid && ctx.Err() == nil
	return nil
}

func validConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Campaign:       "vercel-sandbox-2026q3",
		Count:          3,
		Repeats:        2,
		VCPUs:          2,
		Runtime:        "node24",
		PriceHour:      0.30,
		PriceMonth:     219,
		Binary:         "/unused/providerbench-linux-amd64",
		OutputDir:      t.TempDir(),
		PricingAsOf:    "2026-07-24",
		PricingBasis:   "continuous full-utilization equivalent",
		SandboxTimeout: 10 * time.Minute,
		CommandTimeout: 4 * time.Minute,
	}
}

func TestRunnerUsesFreshSequentialSandboxesAndRepeats(t *testing.T) {
	client := &fakeClient{deleteContextsValid: true}
	cfg := validConfig(t)
	runner := Runner{
		Client: client,
		NewRunID: func() (string, error) {
			return "abcd1234", nil
		},
	}

	if err := runner.Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if got, want := countPrefix(client.events, "create-"), cfg.Count; got != want {
		t.Fatalf("created %d Sandboxes, want %d: %v", got, want, client.events)
	}
	if got, want := countPrefix(client.events, "benchmark-"), cfg.Count*cfg.Repeats; got != want {
		t.Fatalf("ran %d benchmarks, want %d: %v", got, want, client.events)
	}
	firstName := sandboxName(cfg, "abcd1234", 1)
	secondName := sandboxName(cfg, "abcd1234", 2)
	if indexOf(client.events, "remove-"+firstName) > indexOf(client.events, "create-"+secondName) {
		t.Fatalf("second Sandbox was created before the first was removed: %v", client.events)
	}
	for sample := 1; sample <= cfg.Count; sample++ {
		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			path := filepath.Join(cfg.OutputDir, fmt.Sprintf(
				"vercel-sandbox-2vcpu-iad1-vercel-sandbox-2026q3-%d-%d.json",
				sample,
				repeat,
			))
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("missing report %s: %v", path, err)
			}
		}
	}
}

func TestRunnerCleansSandboxAfterCancelledFailure(t *testing.T) {
	client := &fakeClient{deleteContextsValid: true, failBenchmark: true}
	cfg := validConfig(t)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	runner := Runner{
		Client: client,
		NewRunID: func() (string, error) {
			return "abcd1234", nil
		},
	}

	err := runner.Run(cancelled, cfg)
	if err == nil {
		t.Fatal("expected benchmark failure")
	}
	if len(client.removed) != 1 {
		t.Fatalf("cleanup removed %d Sandboxes, want 1: %v", len(client.removed), client.events)
	}
	if !client.deleteContextsValid {
		t.Fatal("cleanup used the cancelled campaign context")
	}
}

func TestRunnerRefusesToOverwriteHistoricalReport(t *testing.T) {
	client := &fakeClient{deleteContextsValid: true}
	cfg := validConfig(t)
	existing := localReportPath(cfg, 1, 1)
	if err := os.WriteFile(existing, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	runner := Runner{
		Client: client,
		NewRunID: func() (string, error) {
			return "abcd1234", nil
		},
	}

	err := runner.Run(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "report already exists") {
		t.Fatalf("expected overwrite refusal, got %v", err)
	}
	if len(client.events) != 0 {
		t.Fatalf("Vercel was contacted before collision check: %v", client.events)
	}
}

func TestValidateRejectsInvalidConfiguration(t *testing.T) {
	cfg := validConfig(t)
	cfg.Runtime = "node24; reboot"
	cfg.Repeats = 0
	cfg.VCPUs = 0
	cfg.CommandTimeout = 11 * time.Minute
	err := Validate(cfg)
	if err == nil {
		t.Fatal("expected validation failure")
	}
	for _, want := range []string{"--runtime", "--repeats", "--vcpus", "--command-timeout"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("validation error %q does not mention %s", err, want)
		}
	}
}

func TestCLIDuration(t *testing.T) {
	for _, test := range []struct {
		input time.Duration
		want  string
	}{
		{10 * time.Minute, "10m"},
		{2 * time.Hour, "2h"},
		{90 * time.Second, "1m30s"},
	} {
		if got := cliDuration(test.input); got != test.want {
			t.Errorf("cliDuration(%s) = %q, want %q", test.input, got, test.want)
		}
	}
}

func parseArgs(args []string) map[string]string {
	values := make(map[string]string)
	for i := 0; i+1 < len(args); i++ {
		if strings.HasPrefix(args[i], "--") {
			values[args[i]] = args[i+1]
			i++
		}
	}
	return values
}

func envValue(args []string, key string) string {
	prefix := key + "="
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--env" && strings.HasPrefix(args[i+1], prefix) {
			return strings.TrimPrefix(args[i+1], prefix)
		}
	}
	return ""
}

func indexOf(values []string, target string) int {
	for i, value := range values {
		if value == target {
			return i
		}
	}
	return -1
}

func countPrefix(values []string, prefix string) int {
	count := 0
	for _, value := range values {
		if strings.HasPrefix(value, prefix) {
			count++
		}
	}
	return count
}
