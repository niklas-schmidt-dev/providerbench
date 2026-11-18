package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/campaign/hetzner"
)

type fakeCloud struct {
	events         *[]string
	nextServer     int
	deletedServers []hetzner.Server
	deletedGroup   bool
	failCreateAt   int
}

func (f *fakeCloud) ResolveSSHKey(context.Context, string) (int64, error) {
	*f.events = append(*f.events, "resolve-key")
	return 42, nil
}

func (f *fakeCloud) CreatePlacementGroup(context.Context, string, map[string]string) (hetzner.PlacementGroup, error) {
	*f.events = append(*f.events, "create-group")
	return hetzner.PlacementGroup{ID: 7, Name: "group"}, nil
}

func (f *fakeCloud) DeletePlacementGroup(context.Context, hetzner.PlacementGroup) error {
	*f.events = append(*f.events, "delete-group")
	f.deletedGroup = true
	return nil
}

func (f *fakeCloud) CreateServer(_ context.Context, opts hetzner.CreateServerOptions) (hetzner.Server, error) {
	f.nextServer++
	*f.events = append(*f.events, fmt.Sprintf("create-server-%d", f.nextServer))
	if f.failCreateAt == f.nextServer {
		return hetzner.Server{}, errors.New("create request failed")
	}
	return hetzner.Server{
		ID:   int64(f.nextServer),
		Name: opts.Name,
		IPv4: fmt.Sprintf("192.0.2.%d", f.nextServer),
	}, nil
}

func (f *fakeCloud) DeleteServer(_ context.Context, server hetzner.Server) error {
	*f.events = append(*f.events, fmt.Sprintf("delete-server-%d", server.ID))
	f.deletedServers = append(f.deletedServers, server)
	return nil
}

type fakeRemote struct {
	events     *[]string
	failRun    bool
	scripts    []string
	secrets    map[string][]byte
	lastValues map[string]string
}

func (f *fakeRemote) WaitReady(_ context.Context, server hetzner.Server, _ time.Duration) error {
	*f.events = append(*f.events, fmt.Sprintf("wait-%d", server.ID))
	return nil
}

func (f *fakeRemote) CopyBinary(_ context.Context, server hetzner.Server, _, _ string) error {
	*f.events = append(*f.events, fmt.Sprintf("copy-binary-%d", server.ID))
	return nil
}

func (f *fakeRemote) WriteFile(_ context.Context, server hetzner.Server, path string, data []byte) error {
	*f.events = append(*f.events, fmt.Sprintf("write-secrets-%d", server.ID))
	if f.secrets == nil {
		f.secrets = map[string][]byte{}
	}
	f.secrets[path] = data
	return nil
}

func (f *fakeRemote) Run(_ context.Context, server hetzner.Server, binary string, args []string) error {
	script := binary + " " + strings.Join(args, " ")
	f.scripts = append(f.scripts, script)
	if strings.Contains(script, "rm -f") {
		*f.events = append(*f.events, fmt.Sprintf("shred-secrets-%d", server.ID))
		return nil
	}
	*f.events = append(*f.events, fmt.Sprintf("run-%d", server.ID))
	if f.failRun {
		return errors.New("remote benchmark failed")
	}
	f.lastValues = parseScript(script)
	return nil
}

func (f *fakeRemote) CopyReport(_ context.Context, server hetzner.Server, _, local string) error {
	*f.events = append(*f.events, fmt.Sprintf("copy-report-%d", server.ID))
	sample, _ := strconv.Atoi(f.lastValues["--sample-index"])
	repeat, _ := strconv.Atoi(f.lastValues["--repeat-index"])
	report := map[string]any{
		"schema_version":   bench.SchemaVersion,
		"protocol_version": bench.StorageProtocol,
		"profile":          bench.StandardProfile,
		"cli_version":      "test",
		"category":         "storage",
		"created_at":       time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC),
		"provider": map[string]any{
			"name":    f.lastValues["--provider"],
			"product": f.lastValues["--product"],
			"plan":    f.lastValues["--plan"],
			"tier":    f.lastValues["--tier"],
			"region":  f.lastValues["--region"],
		},
		"measurement": map[string]any{
			"campaign_id":    f.lastValues["--campaign"],
			"sample_index":   sample,
			"repeat_index":   repeat,
			"fresh_instance": true,
		},
		"environment": map[string]any{
			"vantage":      envValue(f.lastValues, "vantage"),
			"vantage_plan": envValue(f.lastValues, "vantage_plan"),
		},
		"system": map[string]any{
			"os":        "linux",
			"arch":      "amd64",
			"cpu_cores": 2,
		},
		"results": []any{map[string]any{
			"test":             "s3",
			"started_at":       time.Date(2026, 7, 28, 12, 0, 1, 0, time.UTC),
			"duration_seconds": 30,
			"metrics": []any{map[string]any{
				"name":             "ttfb_p50",
				"value":            12.5,
				"unit":             "ms",
				"higher_is_better": false,
			}},
		}},
	}
	data, err := json.Marshal(report)
	if err != nil {
		return err
	}
	return os.WriteFile(local, data, 0o644)
}

// parseScript recovers the shell-quoted benchmark arguments from the remote
// script. Test values contain no spaces, so trimming quotes is sufficient.
func parseScript(script string) map[string]string {
	fields := strings.Fields(script)
	values := map[string]string{}
	envIndex := 0
	for i := 0; i+1 < len(fields); i++ {
		key := strings.Trim(fields[i], "'")
		value := strings.Trim(fields[i+1], "'")
		if key == "--env" {
			values["--env-"+strconv.Itoa(envIndex)] = value
			envIndex++
			i++
			continue
		}
		if strings.HasPrefix(key, "--") {
			if strings.HasPrefix(value, "--") {
				values[key] = "true" // boolean flag, e.g. --fresh-instance
				continue
			}
			values[key] = value
			i++
		}
	}
	return values
}

func envValue(values map[string]string, key string) string {
	prefix := key + "="
	for name, value := range values {
		if strings.HasPrefix(name, "--env-") && strings.HasPrefix(value, prefix) {
			return strings.TrimPrefix(value, prefix)
		}
	}
	return ""
}

func validConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Campaign: "r2-2026q3",
		Target: Target{
			Provider:  "cloudflare",
			Product:   "r2",
			Plan:      "standard",
			Tier:      "usage-based",
			Region:    "auto",
			Endpoint:  "https://account.r2.cloudflarestorage.com",
			Bucket:    "pb-bench",
			AccessKey: "AKIA-TEST-ACCESS",
			SecretKey: "very-secret-key-material",
			S3Region:  "auto",
		},
		VantagePlan:   "cpx22",
		VantageRegion: "fsn1",
		Image:         "ubuntu-24.04",
		Count:         3,
		Repeats:       2,
		SSHKeyName:    "Test",
		SSHPrivateKey: "/unused/id_rsa",
		SSHTimeout:    3 * time.Minute,
		Binary:        "/unused/providerbench",
		OutputDir:     t.TempDir(),
		PricingAsOf:   "2026-07-28",
	}
}

func TestRunnerCompletesCohortAndNamesReportsForTheTarget(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events}
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)

	if err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	if got, want := countPrefix(events, "run-"), cfg.Count*cfg.Repeats; got != want {
		t.Fatalf("remote runs = %d, want %d; events: %v", got, want, events)
	}
	if len(cloud.deletedServers) != cfg.Count || !cloud.deletedGroup {
		t.Fatalf("cleanup incomplete: %v", events)
	}
	for sample := 1; sample <= cfg.Count; sample++ {
		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			path := localReportPath(cfg, sample, repeat)
			if !strings.HasSuffix(path, fmt.Sprintf("cloudflare-r2-standard-auto-r2-2026q3-%d-%d.json", sample, repeat)) {
				t.Fatalf("report name does not follow the dataset convention: %s", path)
			}
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("missing report %s: %v", path, err)
			}
		}
	}
}

func TestSecretsTravelByFileNeverByCommandLine(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events}
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)

	if err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}

	for _, script := range remote.scripts {
		for _, secret := range []string{cfg.Target.SecretKey, cfg.Target.AccessKey, cfg.Target.Bucket} {
			if strings.Contains(script, secret) {
				t.Fatalf("secret material leaked into a remote command line: %q", script)
			}
		}
	}
	secrets := string(remote.secrets[remoteSecretsFile])
	for _, want := range []string{
		"PB_S3_ENDPOINT='https://account.r2.cloudflarestorage.com'",
		"PB_S3_SECRET_KEY='very-secret-key-material'",
		"PB_S3_REGION='auto'",
	} {
		if !strings.Contains(secrets, want) {
			t.Fatalf("credentials file is missing %q:\n%s", want, secrets)
		}
	}
	if strings.Contains(secrets, "PB_S3_PREFIX") {
		t.Fatal("unset optional values must not be forwarded")
	}

	// Per host: secrets written before the first run, shredded before deletion.
	for id := 1; id <= cfg.Count; id++ {
		write := indexOf(events, fmt.Sprintf("write-secrets-%d", id))
		run := indexOf(events, fmt.Sprintf("run-%d", id))
		shred := indexOf(events, fmt.Sprintf("shred-secrets-%d", id))
		del := indexOf(events, fmt.Sprintf("delete-server-%d", id))
		if write == -1 || run == -1 || shred == -1 || del == -1 || !(write < run && run < shred && shred < del) {
			t.Fatalf("host %d lifecycle out of order: %v", id, events)
		}
	}
}

func TestRunnerRecordsVantageIdentity(t *testing.T) {
	var events []string
	remote := &fakeRemote{events: &events}
	cfg := validConfig(t)

	if err := (Runner{Cloud: &fakeCloud{events: &events}, Remote: remote}).Run(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if got := envValue(remote.lastValues, "vantage"); got != "hetzner-fsn1" {
		t.Fatalf("vantage env = %q, want hetzner-fsn1", got)
	}
	if got := remote.lastValues["--tier"]; got != "usage-based" {
		t.Fatalf("tier = %q, want usage-based", got)
	}
	if _, ok := remote.lastValues["--price-month"]; ok {
		t.Fatal("zero prices must not be forwarded")
	}
}

func TestRunnerCleansEveryHostAfterRemoteFailure(t *testing.T) {
	var events []string
	cloud := &fakeCloud{events: &events}
	remote := &fakeRemote{events: &events, failRun: true}
	cfg := validConfig(t)

	err := (Runner{Cloud: cloud, Remote: remote}).Run(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected campaign failure")
	}
	if len(cloud.deletedServers) != cfg.Count || !cloud.deletedGroup {
		t.Fatalf("cleanup incomplete after failure: %v", events)
	}
}

func TestValidateRejectsMissingCredentialsAndUnsafeInputs(t *testing.T) {
	cfg := validConfig(t)
	cfg.Target.SecretKey = ""
	cfg.Target.Endpoint = "https://host.example/some/path"
	cfg.Target.Region = "auto; reboot"
	cfg.Repeats = 11
	err := Validate(cfg)
	if err == nil {
		t.Fatal("expected validation failure")
	}
	message := err.Error()
	for _, want := range []string{"PB_S3_SECRET_KEY", "PB_S3_ENDPOINT must not contain a path", "--region", "--repeats"} {
		if !strings.Contains(message, want) {
			t.Errorf("validation error %q does not mention %s", message, want)
		}
	}
}

func TestRunnerRefusesToOverwriteHistoricalReport(t *testing.T) {
	var events []string
	cfg := validConfig(t)
	if err := os.WriteFile(localReportPath(cfg, 1, 1), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := (Runner{Cloud: &fakeCloud{events: &events}, Remote: &fakeRemote{events: &events}}).Run(context.Background(), cfg)
	if err == nil || !strings.Contains(err.Error(), "report already exists") {
		t.Fatalf("expected overwrite refusal, got %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("cloud was contacted before collision check: %v", events)
	}
}

func TestDescribeNeverEchoesCredentials(t *testing.T) {
	cfg := validConfig(t)
	var out strings.Builder
	Describe(&out, cfg)
	text := out.String()
	for _, secret := range []string{cfg.Target.SecretKey, cfg.Target.AccessKey, cfg.Target.Bucket} {
		if strings.Contains(text, secret) {
			t.Fatalf("dry run echoed credential material:\n%s", text)
		}
	}
	if !strings.Contains(text, "account.r2.cloudflarestorage.com") {
		t.Fatalf("dry run should name the endpoint host:\n%s", text)
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
