// Package hetzner orchestrates reproducible ProviderBench campaigns on
// independent Hetzner Cloud hosts.
package hetzner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxSpreadGroupServers = 10
	remoteBinary          = "/usr/local/bin/providerbench"
)

var providerValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Config describes one plan-and-region cohort. Count is the number of
// independent hosts; Repeats is the number of measurements taken per host.
type Config struct {
	Campaign      string
	Plan          string
	Tier          string
	Region        string
	Count         int
	Repeats       int
	PriceHour     float64
	PriceMonth    float64
	SSHKeyName    string
	SSHPrivateKey string
	Image         string
	Binary        string
	OutputDir     string
	Tests         string
	Quick         bool
	PricingAsOf   string
	PricingBasis  string
	SSHTimeout    time.Duration
}

// Server is the subset of a Hetzner server needed by the campaign runner.
type Server struct {
	ID   int64
	Name string
	IPv4 string
}

// PlacementGroup identifies a spread placement group created for a campaign.
type PlacementGroup struct {
	ID   int64
	Name string
}

// CreateServerOptions are provider-neutral inputs used by Cloud.
type CreateServerOptions struct {
	Name             string
	Plan             string
	Image            string
	Region           string
	SSHKeyID         int64
	PlacementGroupID int64
	Labels           map[string]string
}

// Cloud owns the billable-resource lifecycle. The production implementation
// uses hcloud-go; the interface keeps lifecycle behavior independently testable.
type Cloud interface {
	ResolveSSHKey(context.Context, string) (int64, error)
	CreatePlacementGroup(context.Context, string, map[string]string) (PlacementGroup, error)
	DeletePlacementGroup(context.Context, PlacementGroup) error
	CreateServer(context.Context, CreateServerOptions) (Server, error)
	DeleteServer(context.Context, Server) error
}

// Remote runs the benchmark binary on a provisioned host.
type Remote interface {
	WaitReady(context.Context, Server, time.Duration) error
	CopyBinary(context.Context, Server, string, string) error
	Run(context.Context, Server, string, []string) error
	CopyReport(context.Context, Server, string, string) error
}

// Runner coordinates the campaign. All hosts are created before measurement so
// the spread placement group can place them on independent physical hosts.
type Runner struct {
	Cloud  Cloud
	Remote Remote
	Out    io.Writer
	Now    func() time.Time
}

// Validate checks all inputs before any billable resource is created.
func Validate(cfg Config) error {
	var problems []error
	required := []struct {
		name  string
		value string
	}{
		{"campaign", cfg.Campaign},
		{"plan", cfg.Plan},
		{"tier", cfg.Tier},
		{"region", cfg.Region},
		{"ssh-key-name", cfg.SSHKeyName},
		{"image", cfg.Image},
		{"binary", cfg.Binary},
		{"output-dir", cfg.OutputDir},
	}
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			problems = append(problems, fmt.Errorf("--%s is required", field.name))
		}
	}
	for name, value := range map[string]string{
		"plan": cfg.Plan, "tier": cfg.Tier, "region": cfg.Region, "image": cfg.Image,
	} {
		if value != "" && !providerValuePattern.MatchString(value) {
			problems = append(problems, fmt.Errorf("--%s contains unsupported characters", name))
		}
	}
	switch cfg.Tier {
	case "", "cheap", "medium", "dedicated":
	default:
		problems = append(problems, errors.New("--tier must be one of: cheap, medium, dedicated"))
	}
	if cfg.Count < 1 || cfg.Count > maxSpreadGroupServers {
		problems = append(problems, fmt.Errorf("--count must be from 1 to %d (Hetzner spread-group limit)", maxSpreadGroupServers))
	}
	if cfg.Repeats < 1 || cfg.Repeats > 10 {
		problems = append(problems, errors.New("--repeats must be from 1 to 10"))
	}
	if cfg.PriceHour <= 0 || math.IsNaN(cfg.PriceHour) || math.IsInf(cfg.PriceHour, 0) {
		problems = append(problems, errors.New("--price-hour must be a finite number greater than zero"))
	}
	if cfg.PriceMonth <= 0 || math.IsNaN(cfg.PriceMonth) || math.IsInf(cfg.PriceMonth, 0) {
		problems = append(problems, errors.New("--price-month must be a finite number greater than zero"))
	}
	if cfg.SSHTimeout <= 0 {
		problems = append(problems, errors.New("--ssh-timeout must be greater than zero"))
	}
	if cfg.PricingAsOf != "" {
		if _, err := time.Parse(time.DateOnly, cfg.PricingAsOf); err != nil {
			problems = append(problems, errors.New("--pricing-as-of must use YYYY-MM-DD"))
		}
	}
	return errors.Join(problems...)
}

// Describe prints the exact resource and measurement plan without contacting
// Hetzner. It is used by --dry-run.
func Describe(w io.Writer, cfg Config) {
	total := cfg.Count * cfg.Repeats
	hostWord := "hosts"
	if cfg.Count == 1 {
		hostWord = "host"
	}
	fmt.Fprintf(w, "Hetzner campaign dry run\n")
	fmt.Fprintf(w, "  campaign:       %s\n", cfg.Campaign)
	fmt.Fprintf(w, "  plan/region:    %s / %s (%s)\n", cfg.Plan, cfg.Region, cfg.Tier)
	fmt.Fprintf(w, "  hosts:          %d fresh %s in spread group %s\n", cfg.Count, hostWord, placementGroupName(cfg))
	fmt.Fprintf(w, "  measurements:   %d repeats per host, %d reports total\n", cfg.Repeats, total)
	fmt.Fprintf(w, "  output:         %s\n", cfg.OutputDir)
	fmt.Fprintf(w, "  price/server:   %.6f EUR/hour, %.4f EUR/month\n", cfg.PriceHour, cfg.PriceMonth)
	fmt.Fprintf(w, "  max live rate:  %.6f EUR/hour while all %d hosts exist\n", cfg.PriceHour*float64(cfg.Count), cfg.Count)
	fmt.Fprintln(w, "  lifecycle:      create all hosts, benchmark sequentially, delete each host, delete spread group")
	fmt.Fprintln(w, "No API request was made and no resource was created.")
}

// Run creates, measures, and removes one complete cohort. Cleanup uses a fresh
// context so Ctrl-C cannot strand billable resources by cancelling deletion.
func (r Runner) Run(ctx context.Context, cfg Config) (runErr error) {
	if err := Validate(cfg); err != nil {
		return err
	}
	if r.Cloud == nil || r.Remote == nil {
		return errors.New("campaign runner requires cloud and remote clients")
	}
	out := r.Out
	if out == nil {
		out = io.Discard
	}
	now := r.Now
	if now == nil {
		now = time.Now
	}
	if cfg.PricingAsOf == "" {
		cfg.PricingAsOf = now().UTC().Format(time.DateOnly)
	}
	if err := os.MkdirAll(cfg.OutputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	if err := ensureReportPathsAvailable(cfg); err != nil {
		return err
	}

	sshKeyID, err := r.Cloud.ResolveSSHKey(ctx, cfg.SSHKeyName)
	if err != nil {
		return fmt.Errorf("resolve Hetzner SSH key %q: %w", cfg.SSHKeyName, err)
	}

	labels := campaignLabels(cfg)
	group, err := r.Cloud.CreatePlacementGroup(ctx, placementGroupName(cfg), labels)
	groupActive := group.ID != 0
	active := make(map[int64]Server, cfg.Count)

	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		var cleanupErrs []error
		for _, server := range active {
			fmt.Fprintf(out, "cleanup: deleting %s\n", server.Name)
			if err := r.Cloud.DeleteServer(cleanupCtx, server); err != nil {
				cleanupErrs = append(cleanupErrs, fmt.Errorf("delete server %s: %w", server.Name, err))
			}
		}
		if groupActive {
			if err := r.Cloud.DeletePlacementGroup(cleanupCtx, group); err != nil {
				cleanupErrs = append(cleanupErrs, fmt.Errorf("delete placement group %s: %w", group.Name, err))
			}
		}
		if cleanupErr := errors.Join(cleanupErrs...); cleanupErr != nil {
			runErr = errors.Join(runErr, fmt.Errorf("cleanup incomplete: %w", cleanupErr))
		}
	}()
	if err != nil {
		return fmt.Errorf("create spread placement group: %w", err)
	}
	if !groupActive {
		return errors.New("create spread placement group: Hetzner returned no placement-group ID")
	}

	servers := make([]Server, 0, cfg.Count)
	for sample := 1; sample <= cfg.Count; sample++ {
		serverName := serverName(cfg, sample)
		serverLabels := cloneLabels(labels)
		serverLabels["sample_index"] = strconv.Itoa(sample)
		serverLabels["plan"] = safeLabelValue(cfg.Plan)
		serverLabels["region"] = safeLabelValue(cfg.Region)
		fmt.Fprintf(out, "creating host %d/%d: %s\n", sample, cfg.Count, serverName)
		server, err := r.Cloud.CreateServer(ctx, CreateServerOptions{
			Name:             serverName,
			Plan:             cfg.Plan,
			Image:            cfg.Image,
			Region:           cfg.Region,
			SSHKeyID:         sshKeyID,
			PlacementGroupID: group.ID,
			Labels:           serverLabels,
		})
		if server.ID != 0 {
			active[server.ID] = server
		}
		if err != nil {
			return fmt.Errorf("create server %s: %w", serverName, err)
		}
		if server.ID == 0 {
			return fmt.Errorf("create server %s: Hetzner returned no server ID", serverName)
		}
		if server.IPv4 == "" {
			return fmt.Errorf("create server %s: Hetzner returned no public IPv4 address", serverName)
		}
		servers = append(servers, server)
	}

	completed := 0
	for sample, server := range servers {
		sampleIndex := sample + 1
		fmt.Fprintf(out, "\n=== ACTIVE HOST %d/%d: %s (%s) ===\n", sampleIndex, cfg.Count, server.Name, server.IPv4)
		fmt.Fprintf(out, "The other %d campaign host(s) are intentionally idle to preserve independent-host placement.\n", len(active)-1)
		if err := r.Remote.WaitReady(ctx, server, cfg.SSHTimeout); err != nil {
			return fmt.Errorf("wait for SSH on %s: %w", server.Name, err)
		}
		if err := r.Remote.CopyBinary(ctx, server, cfg.Binary, remoteBinary); err != nil {
			return fmt.Errorf("copy benchmark to %s: %w", server.Name, err)
		}

		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			fmt.Fprintf(out, "running repeat %d/%d on host %d/%d\n", repeat, cfg.Repeats, sampleIndex, cfg.Count)
			remoteReport := remoteReportPath(cfg, sampleIndex, repeat)
			args := benchmarkArgs(cfg, sampleIndex, repeat, remoteReport)
			if err := r.Remote.Run(ctx, server, remoteBinary, args); err != nil {
				return fmt.Errorf("benchmark %s sample %d repeat %d: %w", cfg.Plan, sampleIndex, repeat, err)
			}
			localReport := localReportPath(cfg, sampleIndex, repeat)
			partialReport := localReport + ".partial"
			if err := r.Remote.CopyReport(ctx, server, remoteReport, partialReport); err != nil {
				// A truncated partial would otherwise block the retry as a
				// report-path collision.
				_ = os.Remove(partialReport)
				return fmt.Errorf("copy report for sample %d repeat %d: %w", sampleIndex, repeat, err)
			}
			if err := verifyReport(partialReport, cfg, sampleIndex, repeat); err != nil {
				_ = os.Remove(partialReport)
				return err
			}
			if err := os.Rename(partialReport, localReport); err != nil {
				_ = os.Remove(partialReport)
				return fmt.Errorf("publish validated report %s: %w", localReport, err)
			}
			fmt.Fprintf(out, "saved %s\n", localReport)
			completed++
		}

		if err := r.Cloud.DeleteServer(ctx, server); err != nil {
			return fmt.Errorf("delete completed server %s: %w", server.Name, err)
		}
		delete(active, server.ID)
	}

	if err := r.Cloud.DeletePlacementGroup(ctx, group); err != nil {
		return fmt.Errorf("delete placement group %s: %w", group.Name, err)
	}
	groupActive = false
	expected := cfg.Count * cfg.Repeats
	if completed != expected {
		return fmt.Errorf("campaign incomplete: expected %d reports, saved %d", expected, completed)
	}
	fmt.Fprintf(out, "\ncampaign complete: %s %s %s, %d independent hosts, %d reports\n",
		cfg.Campaign, cfg.Plan, cfg.Region, cfg.Count, completed)
	return nil
}

func campaignLabels(cfg Config) map[string]string {
	return map[string]string{
		"managed_by": "providerbench",
		"campaign":   campaignSlug(cfg.Campaign),
	}
}

func cloneLabels(source map[string]string) map[string]string {
	cloned := make(map[string]string, len(source)+3)
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}

func placementGroupName(cfg Config) string {
	return resourceName("providerbench", campaignSlug(cfg.Campaign), cfg.Plan, cfg.Region)
}

func serverName(cfg Config, sample int) string {
	return resourceName("pb", campaignSlug(cfg.Campaign), cfg.Plan, cfg.Region, strconv.Itoa(sample))
}

func resourceName(parts ...string) string {
	const maxLength = 63
	joined := strings.ToLower(strings.Join(parts, "-"))
	joined = strings.NewReplacer("_", "-", ".", "-").Replace(sanitize(joined))
	joined = strings.Join(strings.FieldsFunc(joined, func(r rune) bool { return r == '-' }), "-")
	if len(joined) <= maxLength {
		return joined
	}
	sum := sha256.Sum256([]byte(joined))
	suffix := hex.EncodeToString(sum[:4])
	return strings.TrimRight(joined[:maxLength-len(suffix)-1], "-") + "-" + suffix
}

func campaignSlug(value string) string {
	slug := sanitize(strings.ToLower(value))
	if slug == "" {
		return "campaign"
	}
	if len(slug) <= 63 {
		return slug
	}
	sum := sha256.Sum256([]byte(slug))
	suffix := hex.EncodeToString(sum[:4])
	return strings.TrimRight(slug[:63-len(suffix)-1], "-._") + "-" + suffix
}

func safeLabelValue(value string) string {
	value = sanitize(strings.ToLower(value))
	if value == "" {
		return "unknown"
	}
	if len(value) > 63 {
		value = value[:63]
	}
	return strings.Trim(value, "-._")
}

func sanitize(value string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		allowed := r >= 'a' && r <= 'z' ||
			r >= 'A' && r <= 'Z' ||
			r >= '0' && r <= '9' ||
			r == '_' || r == '.' || r == '-'
		if allowed {
			builder.WriteRune(r)
			lastDash = r == '-'
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-._")
}

func remoteReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("providerbench-%s-%s-%s-%d-%d.json",
		campaignSlug(cfg.Campaign), safeLabelValue(cfg.Plan), safeLabelValue(cfg.Region), sample, repeat)
	return filepath.ToSlash(filepath.Join("/tmp", name))
}

func localReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("hetzner-cloud-vps-%s-%s-%s-%d-%d.json",
		cfg.Plan, cfg.Region, campaignSlug(cfg.Campaign), sample, repeat)
	return filepath.Join(cfg.OutputDir, name)
}

func ensureReportPathsAvailable(cfg Config) error {
	for sample := 1; sample <= cfg.Count; sample++ {
		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			path := localReportPath(cfg, sample, repeat)
			for _, candidate := range []string{path, path + ".partial"} {
				_, err := os.Stat(candidate)
				switch {
				case err == nil:
					return fmt.Errorf("report already exists: %s (use a new --campaign ID to preserve history)", candidate)
				case errors.Is(err, os.ErrNotExist):
					continue
				default:
					return fmt.Errorf("inspect report path %s: %w", candidate, err)
				}
			}
		}
	}
	return nil
}

func benchmarkArgs(cfg Config, sample, repeat int, report string) []string {
	args := []string{
		"run",
		"--provider", "hetzner",
		"--product", "cloud-vps",
		"--plan", cfg.Plan,
		"--tier", cfg.Tier,
		"--region", cfg.Region,
		"--price-hour", strconv.FormatFloat(cfg.PriceHour, 'f', -1, 64),
		"--price-month", strconv.FormatFloat(cfg.PriceMonth, 'f', -1, 64),
		"--campaign", cfg.Campaign,
		"--sample-index", strconv.Itoa(sample),
		"--repeat-index", strconv.Itoa(repeat),
		"--fresh-instance",
		"--env", "os_image=" + cfg.Image,
		"--env", "pricing_as_of=" + cfg.PricingAsOf,
		"--env", "pricing_basis=" + cfg.PricingBasis,
		"--env", "host_strategy=hetzner-spread-placement-group",
		"--json", report,
	}
	if cfg.Tests != "" {
		args = append(args, "--tests", cfg.Tests)
	}
	if cfg.Quick {
		args = append(args, "--quick")
	}
	return args
}

type reportIdentity struct {
	Provider struct {
		Name   string `json:"name"`
		Plan   string `json:"plan"`
		Region string `json:"region"`
	} `json:"provider"`
	Measurement struct {
		CampaignID  string `json:"campaign_id"`
		SampleIndex int    `json:"sample_index"`
		RepeatIndex int    `json:"repeat_index"`
	} `json:"measurement"`
	CreatedAt   time.Time         `json:"created_at"`
	Quick       bool              `json:"quick"`
	Environment map[string]string `json:"environment"`
	Results     []struct {
		Test      string    `json:"test"`
		StartedAt time.Time `json:"started_at"`
	} `json:"results"`
}

func verifyReport(path string, cfg Config, sample, repeat int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read copied report %s: %w", path, err)
	}
	var report reportIdentity
	if err := json.Unmarshal(data, &report); err != nil {
		return fmt.Errorf("copied report %s is invalid JSON: %w", path, err)
	}
	if report.Provider.Name != "hetzner" ||
		report.Provider.Plan != cfg.Plan ||
		report.Provider.Region != cfg.Region ||
		report.Measurement.CampaignID != cfg.Campaign ||
		report.Measurement.SampleIndex != sample ||
		report.Measurement.RepeatIndex != repeat {
		return fmt.Errorf("copied report %s has unexpected campaign identity", path)
	}
	if report.Quick != cfg.Quick {
		return fmt.Errorf("copied report %s does not record the campaign's workload mode", path)
	}
	if report.CreatedAt.IsZero() || len(report.Results) == 0 {
		return fmt.Errorf("copied report %s has no timestamp or benchmark results", path)
	}
	if report.Environment["pricing_as_of"] != cfg.PricingAsOf {
		return fmt.Errorf("copied report %s has no matching pricing date", path)
	}
	for _, result := range report.Results {
		if result.Test == "" || result.StartedAt.IsZero() {
			return fmt.Errorf("copied report %s contains an undated benchmark result", path)
		}
	}
	return nil
}
