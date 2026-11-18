package digitalocean

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

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

type fakeCloud struct {
	sizes               []Size
	createOptions       CreateDropletsOptions
	deleted             []Server
	deleteContextsValid bool
	createErr           error
	deletedTag          string
}

func (f *fakeCloud) ListSizes(context.Context) ([]Size, error) {
	return append([]Size(nil), f.sizes...), nil
}

func (f *fakeCloud) CreateDroplets(_ context.Context, opts CreateDropletsOptions) ([]Server, error) {
	f.createOptions = opts
	servers := make([]Server, 0, len(opts.Names))
	for index, name := range opts.Names {
		servers = append(servers, Server{
			ID:   int64(index + 1),
			Name: name,
			IPv4: fmt.Sprintf("192.0.2.%d", index+1),
		})
	}
	return servers, f.createErr
}

func (f *fakeCloud) DeleteDroplet(ctx context.Context, server Server) error {
	f.deleted = append(f.deleted, server)
	f.deleteContextsValid = f.deleteContextsValid && ctx.Err() == nil
	return nil
}

func (f *fakeCloud) DeleteDropletsByTag(ctx context.Context, tag string) error {
	f.deletedTag = tag
	f.deleteContextsValid = f.deleteContextsValid && ctx.Err() == nil
	return nil
}

type fakeRemote struct {
	lastArgs map[string]string
	lastEnv  map[string]string
	runs     int
	failRun  int
}

func (f *fakeRemote) WaitReady(context.Context, Server, time.Duration) error {
	return nil
}

func (f *fakeRemote) CopyBinary(context.Context, Server, string, string) error {
	return nil
}

func (f *fakeRemote) Run(_ context.Context, _ Server, _ string, args []string) error {
	f.runs++
	if f.failRun == f.runs {
		return errors.New("injected benchmark failure")
	}
	f.lastArgs, f.lastEnv = parseArgs(args)
	return nil
}

func (f *fakeRemote) CopyReport(_ context.Context, _ Server, _, local string) error {
	sample, _ := strconv.Atoi(f.lastArgs["--sample-index"])
	repeat, _ := strconv.Atoi(f.lastArgs["--repeat-index"])
	start := time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC)
	report := map[string]any{
		"schema_version":   bench.SchemaVersion,
		"protocol_version": bench.ComputeProtocol,
		"profile":          bench.StandardProfile,
		"cli_version":      "test",
		"category":         "compute",
		"created_at":       start,
		"provider": map[string]any{
			"name":            "digitalocean",
			"product":         "droplet-basic",
			"plan":            f.lastArgs["--plan"],
			"tier":            "cheap",
			"region":          Region,
			"price_eur_hour":  0.02,
			"price_eur_month": 12.0,
		},
		"measurement": map[string]any{
			"campaign_id":    f.lastArgs["--campaign"],
			"sample_index":   sample,
			"repeat_index":   repeat,
			"fresh_instance": true,
		},
		"environment": f.lastEnv,
		"system": map[string]any{
			"os":           "linux",
			"arch":         "amd64",
			"cpu_cores":    2,
			"mem_total_mb": 4096,
		},
		"results": []any{map[string]any{
			"test":             "cpu",
			"started_at":       start,
			"duration_seconds": 1,
			"metrics": []any{map[string]any{
				"name":             "single_core_hash",
				"value":            1,
				"unit":             "MB/s",
				"higher_is_better": true,
			}},
		}},
	}
	data, err := json.Marshal(report)
	if err != nil {
		return err
	}
	return os.WriteFile(local, data, 0o644)
}

func parseArgs(args []string) (map[string]string, map[string]string) {
	values := make(map[string]string)
	environment := make(map[string]string)
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--env" {
			key, value, ok := strings.Cut(args[index+1], "=")
			if ok {
				environment[key] = value
			}
			index++
			continue
		}
		if strings.HasPrefix(args[index], "--") {
			values[args[index]] = args[index+1]
			index++
		}
	}
	return values, environment
}

func validConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Campaign:          "digitalocean-2026q3",
		SSHKeyFingerprint: "aa:bb:cc",
		SSHPrivateKey:     "/unused/id_rsa",
		Image:             "ubuntu-24-04-x64",
		Binary:            "/unused/providerbench-linux-amd64",
		OutputDir:         t.TempDir(),
		PricingAsOf:       "2026-07-24",
		USDToEUR:          0.85,
		SSHTimeout:        time.Minute,
	}
}

func availableSize(slug string, monthly float64) Size {
	return Size{
		Slug:         slug,
		Description:  "Basic",
		Memory:       requiredRAM,
		VCPUs:        requiredVCPU,
		PriceHourly:  monthly / 730,
		PriceMonthly: monthly,
		Regions:      []string{Region},
		Available:    true,
	}
}

func TestSelectSizeChoosesCheapestMatchingBasicPlan(t *testing.T) {
	selected, err := SelectSize([]Size{
		availableSize("s-premium-intel-2vcpu-4gb", 32),
		availableSize("s-2vcpu-4gb", 24),
		{
			Slug:         "c-2",
			Description:  "CPU-Optimized",
			Memory:       requiredRAM,
			VCPUs:        requiredVCPU,
			PriceHourly:  0.01,
			PriceMonthly: 7,
			Regions:      []string{Region},
			Available:    true,
		},
		{
			Slug:         "unavailable",
			Description:  "Basic",
			Memory:       requiredRAM,
			VCPUs:        requiredVCPU,
			PriceHourly:  0.01,
			PriceMonthly: 8,
			Regions:      []string{Region},
			Available:    false,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if selected.Slug != "s-2vcpu-4gb" {
		t.Fatalf("selected %q, want cheapest matching Basic size", selected.Slug)
	}
}

func TestRunnerCreatesCompleteTaggedCohortAndCleansUp(t *testing.T) {
	cloud := &fakeCloud{
		sizes:               []Size{availableSize("s-2vcpu-4gb", 24)},
		deleteContextsValid: true,
	}
	remote := &fakeRemote{}
	cfg := validConfig(t)
	var output strings.Builder
	err := (Runner{Cloud: cloud, Remote: remote, Out: &output}).Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}

	if got := len(cloud.createOptions.Names); got != hostCount {
		t.Fatalf("created %d hosts, want %d", got, hostCount)
	}
	if cloud.createOptions.Region != Region || cloud.createOptions.Size != "s-2vcpu-4gb" {
		t.Fatalf("unexpected create options: %#v", cloud.createOptions)
	}
	if !contains(cloud.createOptions.Tags, "providerbench") ||
		!contains(cloud.createOptions.Tags, "providerbench-"+campaignSlug(cfg.Campaign)) {
		t.Fatalf("missing campaign tags: %v", cloud.createOptions.Tags)
	}
	if remote.runs != hostCount*repeatCount {
		t.Fatalf("ran %d reports, want %d", remote.runs, hostCount*repeatCount)
	}
	if len(cloud.deleted) != hostCount || !cloud.deleteContextsValid {
		t.Fatalf("cleanup deleted %d hosts with valid context=%v", len(cloud.deleted), cloud.deleteContextsValid)
	}
	if cloud.deletedTag != "providerbench-"+campaignSlug(cfg.Campaign) {
		t.Fatalf("tag cleanup used %q", cloud.deletedTag)
	}
	matches, err := filepath.Glob(filepath.Join(cfg.OutputDir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != hostCount*repeatCount {
		t.Fatalf("saved %d reports, want %d", len(matches), hostCount*repeatCount)
	}
}

func TestRunnerCleansEveryDropletAfterBenchmarkFailure(t *testing.T) {
	cloud := &fakeCloud{
		sizes:               []Size{availableSize("s-2vcpu-4gb", 24)},
		deleteContextsValid: true,
	}
	cfg := validConfig(t)
	err := (Runner{
		Cloud:  cloud,
		Remote: &fakeRemote{failRun: 1},
	}).Run(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "injected benchmark failure") {
		t.Fatalf("Run error = %v", err)
	}
	if len(cloud.deleted) != hostCount || !cloud.deleteContextsValid {
		t.Fatalf("cleanup deleted %d hosts with valid context=%v", len(cloud.deleted), cloud.deleteContextsValid)
	}
	if cloud.deletedTag == "" {
		t.Fatal("tag cleanup was not attempted")
	}
}

func TestRunnerCleansPartialMultiCreateOutcomeByIDAndTag(t *testing.T) {
	cloud := &fakeCloud{
		sizes:               []Size{availableSize("s-2vcpu-4gb", 24)},
		deleteContextsValid: true,
		createErr:           errors.New("ambiguous create response"),
	}
	cfg := validConfig(t)
	err := (Runner{
		Cloud:  cloud,
		Remote: &fakeRemote{},
	}).Run(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "ambiguous create response") {
		t.Fatalf("Run error = %v", err)
	}
	if len(cloud.deleted) != hostCount || cloud.deletedTag == "" {
		t.Fatalf("cleanup deleted %d hosts and tag %q", len(cloud.deleted), cloud.deletedTag)
	}
}

func TestDescribeIsExplicitlyReadOnly(t *testing.T) {
	cfg := validConfig(t)
	var output strings.Builder
	Describe(&output, cfg)
	for _, text := range []string{
		"cheapest available Basic size",
		"10 fresh",
		"3 repeats",
		"No API request was made",
	} {
		if !strings.Contains(output.String(), text) {
			t.Fatalf("dry-run output missing %q:\n%s", text, output.String())
		}
	}
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
