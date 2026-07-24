package hetzner

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

type fakeCloud struct {
	events              *[]string
	nextServer          int
	deletedServers      []Server
	deletedGroup        bool
	deleteContextsValid bool
	failCreateAt        int
	returnPartial       bool
}

func (f *fakeCloud) ResolveSSHKey(context.Context, string) (int64, error) {
	*f.events = append(*f.events, "resolve-key")
	return 42, nil
}

func (f *fakeCloud) CreatePlacementGroup(context.Context, string, map[string]string) (PlacementGroup, error) {
	*f.events = append(*f.events, "create-group")
	return PlacementGroup{ID: 7, Name: "group"}, nil
}

func (f *fakeCloud) DeletePlacementGroup(ctx context.Context, _ PlacementGroup) error {
	*f.events = append(*f.events, "delete-group")
	f.deletedGroup = true
	f.deleteContextsValid = f.deleteContextsValid && ctx.Err() == nil
	return nil
}

func (f *fakeCloud) CreateServer(_ context.Context, opts CreateServerOptions) (Server, error) {
	f.nextServer++
	*f.events = append(*f.events, fmt.Sprintf("create-server-%d", f.nextServer))
	server := Server{ID: int64(f.nextServer), Name: opts.Name, IPv4: fmt.Sprintf("192.0.2.%d", f.nextServer)}
	if f.failCreateAt == f.nextServer {
		if f.returnPartial {
			return server, errors.New("create action failed")
		}
		return Server{}, errors.New("create request failed")
	}
	return server, nil
}

func (f *fakeCloud) DeleteServer(ctx context.Context, server Server) error {
	*f.events = append(*f.events, fmt.Sprintf("delete-server-%d", server.ID))
	f.deletedServers = append(f.deletedServers, server)
	f.deleteContextsValid = f.deleteContextsValid && ctx.Err() == nil
	return nil
}

type fakeRemote struct {
	events      *[]string
	failRun     bool
	last        map[string]string
	pricingDate string
}

func (f *fakeRemote) WaitReady(_ context.Context, server Server, _ time.Duration) error {
	*f.events = append(*f.events, fmt.Sprintf("wait-%d", server.ID))
	return nil
}

func (f *fakeRemote) CopyBinary(_ context.Context, server Server, _, _ string) error {
	*f.events = append(*f.events, fmt.Sprintf("copy-binary-%d", server.ID))
	return nil
}

func (f *fakeRemote) Run(_ context.Context, server Server, _ string, args []string) error {
	*f.events = append(*f.events, fmt.Sprintf("run-%d", server.ID))
	if f.failRun {
		return errors.New("remote benchmark failed")
	}
	f.last = parseArgs(args)
	f.pricingDate = envValue(args, "pricing_as_of")
	return nil
}

func (f *fakeRemote) CopyReport(_ context.Context, server Server, _, local string) error {
	*f.events = append(*f.events, fmt.Sprintf("copy-report-%d", server.ID))
	sample, _ := strconv.Atoi(f.last["--sample-index"])
	repeat, _ := strconv.Atoi(f.last["--repeat-index"])
	report := map[string]any{
		"created_at": time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC),
		"provider": map[string]any{
			"name":   "hetzner",
			"plan":   f.last["--plan"],
			"region": f.last["--region"],
		},
		"measurement": map[string]any{
			"campaign_id":  f.last["--campaign"],
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

func validConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Campaign:      "hetzner-2026q3",
		Plan:          "cpx22",
		Tier:          "medium",
		Region:        "fsn1",
		Count:         3,
		Repeats:       2,
		PriceHour:     0.03808,
		PriceMonth:    23.7881,
		SSHKeyName:    "Test",
		SSHPrivateKey: "/unused/id_rsa",
		Image:         "ubuntu-24.04",
		Binary:        "/unused/providerbench",
		OutputDir:     t.TempDir(),
		PricingAsOf:   "2026-07-24",
		PricingBasis:  "server+primary-ipv4-incl-19pct-vat",
		SSHTimeout:    3 * time.Minute,
	}
}

func TestRunnerCreatesWholeSpreadCohortBeforeMeasuring(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events, deleteContextsValid: true}
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)

	err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}

	firstWait := indexOf(events, "wait-1")
	lastCreate := indexOf(events, "create-server-3")
	if firstWait == -1 || lastCreate == -1 || firstWait < lastCreate {
		t.Fatalf("measurement began before all hosts existed: %v", events)
	}
	if got, want := countPrefix(events, "run-"), cfg.Count*cfg.Repeats; got != want {
		t.Fatalf("remote runs = %d, want %d; events: %v", got, want, events)
	}
	if got, want := len(cloud.deletedServers), cfg.Count; got != want {
		t.Fatalf("deleted servers = %d, want %d", got, want)
	}
	if !cloud.deletedGroup {
		t.Fatal("spread placement group was not deleted")
	}
	if !cloud.deleteContextsValid {
		t.Fatal("cleanup used a cancelled context")
	}
	for sample := 1; sample <= cfg.Count; sample++ {
		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			path := filepath.Join(cfg.OutputDir, fmt.Sprintf("hetzner-cloud-vps-cpx22-fsn1-hetzner-2026q3-%d-%d.json", sample, repeat))
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("missing report %s: %v", path, err)
			}
		}
	}
}

func TestRunnerCleansEveryHostAfterRemoteFailure(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events, deleteContextsValid: true}
	remote := &fakeRemote{events: &events, failRun: true}
	cfg := validConfig(t)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	err := (Runner{Cloud: cloud, Remote: remote}).Run(cancelled, cfg)
	if err == nil {
		t.Fatal("expected campaign failure")
	}
	if len(cloud.deletedServers) != cfg.Count {
		t.Fatalf("cleanup deleted %d/%d servers: %v", len(cloud.deletedServers), cfg.Count, events)
	}
	if !cloud.deletedGroup || !cloud.deleteContextsValid {
		t.Fatalf("cleanup did not use an independent context: %v", events)
	}
}

func TestRunnerCleansPartialCreateResult(t *testing.T) {
	var events []string
	cloud := &fakeCloud{
		events:              &events,
		deleteContextsValid: true,
		failCreateAt:        2,
		returnPartial:       true,
	}
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)

	err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected create failure")
	}
	if got, want := len(cloud.deletedServers), 2; got != want {
		t.Fatalf("cleanup deleted %d servers, want %d: %v", got, want, events)
	}
	if !cloud.deletedGroup {
		t.Fatal("placement group was not deleted")
	}
}

func TestValidateRejectsUnsafeOrRunawayInputs(t *testing.T) {
	cfg := validConfig(t)
	cfg.Region = "fsn1; reboot"
	cfg.Repeats = 11
	cfg.PriceHour = 0
	err := Validate(cfg)
	if err == nil {
		t.Fatal("expected validation failure")
	}
	message := err.Error()
	for _, want := range []string{"--region", "--repeats", "--price-hour"} {
		if !strings.Contains(message, want) {
			t.Errorf("validation error %q does not mention %s", message, want)
		}
	}
}

func TestRunnerRefusesToOverwriteHistoricalReport(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events, deleteContextsValid: true}
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)
	existing := localReportPath(cfg, 1, 1)
	if err := os.WriteFile(existing, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "report already exists") {
		t.Fatalf("expected overwrite refusal, got %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("cloud was contacted before collision check: %v", events)
	}
}

func TestResourceNamesAreStableAndBounded(t *testing.T) {
	cfg := validConfig(t)
	cfg.Campaign = strings.Repeat("long campaign ", 20)
	first := placementGroupName(cfg)
	second := placementGroupName(cfg)
	if first != second {
		t.Fatalf("resource name is not stable: %q != %q", first, second)
	}
	if len(first) > 63 {
		t.Fatalf("resource name length = %d, want <= 63", len(first))
	}
}

func TestShellQuote(t *testing.T) {
	got := shellQuote("a value with 'quotes' and $HOME")
	want := `'a value with '"'"'quotes'"'"' and $HOME'`
	if got != want {
		t.Fatalf("shellQuote() = %q, want %q", got, want)
	}
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
