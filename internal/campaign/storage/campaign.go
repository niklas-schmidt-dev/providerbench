// Package storage orchestrates object-storage campaigns: fresh Hetzner
// vantage hosts run the s3 suite against one S3-compatible target endpoint.
// One runner covers every storage provider — the target is data, not code.
//
// The vantage point is part of the storage-v1 method (see
// docs/protocols/storage-v1.md): all samples of a cohort measure from
// independently provisioned hosts of one plan in one Hetzner region, and the
// vantage is recorded in every report's environment.
package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/campaign/hetzner"
)

const (
	maxSpreadGroupServers = 10
	remoteBinary          = "/usr/local/bin/providerbench"
	remoteSecretsFile     = "/root/providerbench-s3.env"
)

var providerValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Target identifies the storage offering being measured and the credentials
// the suite needs to reach it. Credentials are read from PB_S3_* environment
// variables by the CLI layer and never appear in flags or reports.
type Target struct {
	Provider string // company, e.g. cloudflare
	Product  string // offering, e.g. r2
	Plan     string // plan/class, e.g. standard
	Tier     string // optional price tier, usually usage-based
	Region   string // bucket region as sold, e.g. auto or eu-central

	Endpoint  string // https://... S3-compatible endpoint
	Bucket    string
	AccessKey string
	SecretKey string
	// Optional passthroughs, forwarded verbatim when set.
	S3Region  string
	S3Prefix  string
	PathStyle string

	PriceHour  float64 // optional: storage pricing rarely maps to a flat rate
	PriceMonth float64
}

// Config describes one storage cohort: the target plus the vantage fleet.
type Config struct {
	Campaign string
	Target   Target

	VantagePlan   string // Hetzner server type running the suite, e.g. cpx22
	VantageRegion string // Hetzner location, e.g. fsn1
	Image         string
	Count         int
	Repeats       int

	SSHKeyName    string
	SSHPrivateKey string
	SSHTimeout    time.Duration
	Binary        string
	OutputDir     string
	Quick         bool
	PricingAsOf   string
}

// Remote runs the benchmark on a vantage host. It extends the compute
// campaign's transport with WriteFile so credentials reach the host without
// ever entering a command line.
type Remote interface {
	WaitReady(context.Context, hetzner.Server, time.Duration) error
	CopyBinary(context.Context, hetzner.Server, string, string) error
	WriteFile(context.Context, hetzner.Server, string, []byte) error
	Run(context.Context, hetzner.Server, string, []string) error
	CopyReport(context.Context, hetzner.Server, string, string) error
}

// Runner coordinates the campaign. Vantage hosts are Hetzner servers in one
// spread placement group, exactly like a compute cohort.
type Runner struct {
	Cloud  hetzner.Cloud
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
		{"provider", cfg.Target.Provider},
		{"product", cfg.Target.Product},
		{"plan", cfg.Target.Plan},
		{"region", cfg.Target.Region},
		{"vantage-plan", cfg.VantagePlan},
		{"vantage-region", cfg.VantageRegion},
		{"image", cfg.Image},
		{"ssh-key-name", cfg.SSHKeyName},
		{"binary", cfg.Binary},
		{"output-dir", cfg.OutputDir},
	}
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			problems = append(problems, fmt.Errorf("--%s is required", field.name))
		}
	}
	for name, value := range map[string]string{
		"provider": cfg.Target.Provider, "product": cfg.Target.Product,
		"plan": cfg.Target.Plan, "region": cfg.Target.Region,
		"vantage-plan": cfg.VantagePlan, "vantage-region": cfg.VantageRegion,
		"image": cfg.Image,
	} {
		if value != "" && !providerValuePattern.MatchString(value) {
			problems = append(problems, fmt.Errorf("--%s contains unsupported characters", name))
		}
	}
	if !bench.ValidTier(cfg.Target.Tier) {
		problems = append(problems, errors.New("--tier must be one of: cheap, medium, dedicated, usage-based"))
	}
	for name, value := range map[string]string{
		"PB_S3_ENDPOINT": cfg.Target.Endpoint, "PB_S3_BUCKET": cfg.Target.Bucket,
		"PB_S3_ACCESS_KEY": cfg.Target.AccessKey, "PB_S3_SECRET_KEY": cfg.Target.SecretKey,
	} {
		if strings.TrimSpace(value) == "" {
			problems = append(problems, fmt.Errorf("%s must be set in the environment", name))
		}
	}
	if cfg.Target.Endpoint != "" {
		endpoint, err := url.Parse(cfg.Target.Endpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
			problems = append(problems, errors.New("PB_S3_ENDPOINT must be an http(s) URL"))
		} else if endpoint.Path != "" && endpoint.Path != "/" {
			problems = append(problems, errors.New("PB_S3_ENDPOINT must not contain a path; the bucket comes from PB_S3_BUCKET"))
		}
	}
	if cfg.Count < 1 || cfg.Count > maxSpreadGroupServers {
		problems = append(problems, fmt.Errorf("--count must be from 1 to %d (Hetzner spread-group limit)", maxSpreadGroupServers))
	}
	if cfg.Repeats < 1 || cfg.Repeats > 10 {
		problems = append(problems, errors.New("--repeats must be from 1 to 10"))
	}
	for name, value := range map[string]float64{
		"price-hour": cfg.Target.PriceHour, "price-month": cfg.Target.PriceMonth,
	} {
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			problems = append(problems, fmt.Errorf("--%s must be a finite number >= 0", name))
		}
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

// Describe prints the exact plan without contacting any API. Credentials are
// summarized, never echoed.
func Describe(w io.Writer, cfg Config) {
	endpointHost := cfg.Target.Endpoint
	if parsed, err := url.Parse(cfg.Target.Endpoint); err == nil && parsed.Host != "" {
		endpointHost = parsed.Host
	}
	fmt.Fprintf(w, "Storage campaign dry run\n")
	fmt.Fprintf(w, "  campaign:       %s\n", cfg.Campaign)
	fmt.Fprintf(w, "  target:         %s %s · plan %s · region %s\n",
		cfg.Target.Provider, cfg.Target.Product, cfg.Target.Plan, cfg.Target.Region)
	fmt.Fprintf(w, "  endpoint:       %s (bucket and credentials read from PB_S3_*)\n", endpointHost)
	fmt.Fprintf(w, "  vantage:        %d fresh Hetzner %s host(s) in %s, spread group %s\n",
		cfg.Count, cfg.VantagePlan, cfg.VantageRegion, placementGroupName(cfg))
	fmt.Fprintf(w, "  measurements:   %d repeats per vantage host, %d reports total\n", cfg.Repeats, cfg.Count*cfg.Repeats)
	fmt.Fprintf(w, "  output:         %s\n", cfg.OutputDir)
	fmt.Fprintln(w, "  lifecycle:      create vantage hosts, deliver credentials over SSH stdin,")
	fmt.Fprintln(w, "                  run the s3 suite, remove credentials, delete every host and the group")
	fmt.Fprintln(w, "No API request was made and no resource was created.")
}

// Run creates, measures, and removes one complete storage cohort. Cleanup
// uses a fresh context so Ctrl-C cannot strand billable resources.
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

	labels := map[string]string{
		"managed_by": "providerbench",
		"campaign":   slug(cfg.Campaign),
		"category":   "storage",
	}
	group, err := r.Cloud.CreatePlacementGroup(ctx, placementGroupName(cfg), labels)
	groupActive := group.ID != 0
	active := make(map[int64]hetzner.Server, cfg.Count)

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

	servers := make([]hetzner.Server, 0, cfg.Count)
	for sample := 1; sample <= cfg.Count; sample++ {
		name := vantageName(cfg, sample)
		serverLabels := map[string]string{
			"sample_index": strconv.Itoa(sample),
			"target":       slug(cfg.Target.Provider + "-" + cfg.Target.Product),
		}
		maps.Copy(serverLabels, labels)
		fmt.Fprintf(out, "creating vantage host %d/%d: %s\n", sample, cfg.Count, name)
		server, err := r.Cloud.CreateServer(ctx, hetzner.CreateServerOptions{
			Name:             name,
			Plan:             cfg.VantagePlan,
			Image:            cfg.Image,
			Region:           cfg.VantageRegion,
			SSHKeyID:         sshKeyID,
			PlacementGroupID: group.ID,
			Labels:           serverLabels,
		})
		if server.ID != 0 {
			active[server.ID] = server
		}
		if err != nil {
			return fmt.Errorf("create vantage host %s: %w", name, err)
		}
		if server.ID == 0 {
			return fmt.Errorf("create vantage host %s: Hetzner returned no server ID", name)
		}
		if server.IPv4 == "" {
			return fmt.Errorf("create vantage host %s: Hetzner returned no public IPv4 address", name)
		}
		servers = append(servers, server)
	}

	completed := 0
	for index, server := range servers {
		sample := index + 1
		fmt.Fprintf(out, "\n=== ACTIVE VANTAGE %d/%d: %s (%s) ===\n", sample, cfg.Count, server.Name, server.IPv4)
		if err := r.Remote.WaitReady(ctx, server, cfg.SSHTimeout); err != nil {
			return fmt.Errorf("wait for SSH on %s: %w", server.Name, err)
		}
		if err := r.Remote.CopyBinary(ctx, server, cfg.Binary, remoteBinary); err != nil {
			return fmt.Errorf("copy benchmark to %s: %w", server.Name, err)
		}
		if err := r.Remote.WriteFile(ctx, server, remoteSecretsFile, secretsFile(cfg.Target)); err != nil {
			return fmt.Errorf("deliver credentials to %s: %w", server.Name, err)
		}

		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			fmt.Fprintf(out, "running repeat %d/%d on vantage %d/%d\n", repeat, cfg.Repeats, sample, cfg.Count)
			remoteReport := remoteReportPath(cfg, sample, repeat)
			script := runScript(cfg, sample, repeat, remoteReport)
			if err := r.Remote.Run(ctx, server, "/bin/sh", []string{"-c", script}); err != nil {
				return fmt.Errorf("benchmark %s sample %d repeat %d: %w", cfg.Target.Product, sample, repeat, err)
			}
			localReport := localReportPath(cfg, sample, repeat)
			partialReport := localReport + ".partial"
			if err := r.Remote.CopyReport(ctx, server, remoteReport, partialReport); err != nil {
				_ = os.Remove(partialReport)
				return fmt.Errorf("copy report for sample %d repeat %d: %w", sample, repeat, err)
			}
			if err := verifyReport(partialReport, cfg, sample, repeat); err != nil {
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

		// Shred the credentials before the host goes back; deletion would
		// destroy them anyway, but never rely on that alone.
		if err := r.Remote.Run(ctx, server, "/bin/sh", []string{"-c", "rm -f " + shellQuote(remoteSecretsFile)}); err != nil {
			fmt.Fprintf(out, "warning: could not remove credentials file on %s before deletion: %v\n", server.Name, err)
		}
		if err := r.Cloud.DeleteServer(ctx, server); err != nil {
			return fmt.Errorf("delete completed vantage host %s: %w", server.Name, err)
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
	fmt.Fprintf(out, "\ncampaign complete: %s %s/%s from %d vantage hosts, %d reports\n",
		cfg.Campaign, cfg.Target.Provider, cfg.Target.Product, cfg.Count, completed)
	return nil
}

// vantage returns the environment value identifying where the suite ran —
// required by the storage-v1 protocol.
func vantage(cfg Config) string {
	return "hetzner-" + strings.ToLower(cfg.VantageRegion)
}

// secretsFile renders the PB_S3_* environment as a shell-sourceable file.
// Optional values are forwarded only when set locally.
func secretsFile(target Target) []byte {
	var b strings.Builder
	write := func(key, value string) {
		if value != "" {
			b.WriteString("export " + key + "=" + shellQuote(value) + "\n")
		}
	}
	write("PB_S3_ENDPOINT", target.Endpoint)
	write("PB_S3_BUCKET", target.Bucket)
	write("PB_S3_ACCESS_KEY", target.AccessKey)
	write("PB_S3_SECRET_KEY", target.SecretKey)
	write("PB_S3_REGION", target.S3Region)
	write("PB_S3_PREFIX", target.S3Prefix)
	write("PB_S3_PATH_STYLE", target.PathStyle)
	return []byte(b.String())
}

// runScript sources the credentials file and execs the benchmark, so the
// secrets exist in the remote process environment only — never in argv.
func runScript(cfg Config, sample, repeat int, report string) string {
	args := []string{
		remoteBinary, "run", "-t", "s3",
		"--provider", cfg.Target.Provider,
		"--product", cfg.Target.Product,
		"--plan", cfg.Target.Plan,
		"--region", cfg.Target.Region,
		"--campaign", cfg.Campaign,
		"--sample-index", strconv.Itoa(sample),
		"--repeat-index", strconv.Itoa(repeat),
		"--fresh-instance",
		"--env", "vantage=" + vantage(cfg),
		"--env", "vantage_plan=" + cfg.VantagePlan,
		"--env", "os_image=" + cfg.Image,
		"--env", "pricing_as_of=" + cfg.PricingAsOf,
		"--json", report,
	}
	if cfg.Target.Tier != "" {
		args = append(args, "--tier", cfg.Target.Tier)
	}
	if cfg.Target.PriceHour > 0 {
		args = append(args, "--price-hour", strconv.FormatFloat(cfg.Target.PriceHour, 'f', -1, 64))
	}
	if cfg.Target.PriceMonth > 0 {
		args = append(args, "--price-month", strconv.FormatFloat(cfg.Target.PriceMonth, 'f', -1, 64))
	}
	if cfg.Quick {
		args = append(args, "--quick")
	}
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = shellQuote(arg)
	}
	return ". " + shellQuote(remoteSecretsFile) + " && exec " + strings.Join(quoted, " ")
}

func placementGroupName(cfg Config) string {
	return resourceName("providerbench", slug(cfg.Campaign), cfg.Target.Provider, cfg.Target.Product)
}

func vantageName(cfg Config, sample int) string {
	return resourceName("pb", slug(cfg.Campaign), cfg.Target.Provider, cfg.Target.Product, strconv.Itoa(sample))
}

func remoteReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("providerbench-%s-%s-%d-%d.json",
		slug(cfg.Campaign), slug(cfg.Target.Product), sample, repeat)
	return filepath.ToSlash(filepath.Join("/tmp", name))
}

// localReportPath follows the dataset naming convention:
// <provider>-<product>-<plan>-<region>-<campaign>-<sample>-<repeat>.json
func localReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("%s-%s-%s-%s-%s-%d-%d.json",
		slug(cfg.Target.Provider), slug(cfg.Target.Product), slug(cfg.Target.Plan),
		slug(cfg.Target.Region), slug(cfg.Campaign), sample, repeat)
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

type reportIdentity struct {
	Provider struct {
		Name    string `json:"name"`
		Product string `json:"product"`
		Plan    string `json:"plan"`
		Region  string `json:"region"`
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
	validated, validationErrs := bench.ValidateReport(data)
	if len(validationErrs) > 0 {
		return fmt.Errorf("copied report %s fails the report contract: %v", path, errors.Join(validationErrs...))
	}
	if validated.Category != "storage" || validated.ProtocolVersion != bench.StorageProtocol || validated.Profile != bench.StandardProfile {
		return fmt.Errorf("copied report %s has unexpected category/protocol/profile", path)
	}
	var report reportIdentity
	if err := json.Unmarshal(data, &report); err != nil {
		return fmt.Errorf("copied report %s is invalid JSON: %w", path, err)
	}
	if report.Provider.Name != cfg.Target.Provider ||
		report.Provider.Product != cfg.Target.Product ||
		report.Provider.Plan != cfg.Target.Plan ||
		report.Provider.Region != cfg.Target.Region ||
		report.Measurement.CampaignID != cfg.Campaign ||
		report.Measurement.SampleIndex != sample ||
		report.Measurement.RepeatIndex != repeat {
		return fmt.Errorf("copied report %s has unexpected campaign identity", path)
	}
	if report.Quick != cfg.Quick {
		return fmt.Errorf("copied report %s does not record the campaign's workload mode", path)
	}
	if report.Environment["vantage"] != vantage(cfg) {
		return fmt.Errorf("copied report %s does not record the vantage %q", path, vantage(cfg))
	}
	if report.CreatedAt.IsZero() || len(report.Results) == 0 {
		return fmt.Errorf("copied report %s has no timestamp or benchmark results", path)
	}
	hasSuite := false
	for _, result := range report.Results {
		if result.Test == "" || result.StartedAt.IsZero() {
			return fmt.Errorf("copied report %s contains an undated benchmark result", path)
		}
		if result.Test == "s3" {
			hasSuite = true
		}
	}
	if !hasSuite {
		return fmt.Errorf("copied report %s does not contain the s3 suite", path)
	}
	return nil
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

func slug(value string) string {
	cleaned := sanitize(strings.ToLower(value))
	if cleaned == "" {
		return "unknown"
	}
	if len(cleaned) <= 63 {
		return cleaned
	}
	sum := sha256.Sum256([]byte(cleaned))
	suffix := hex.EncodeToString(sum[:4])
	return strings.TrimRight(cleaned[:63-len(suffix)-1], "-._") + "-" + suffix
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

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}
