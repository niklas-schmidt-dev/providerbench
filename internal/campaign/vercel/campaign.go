// Package vercel orchestrates reproducible ProviderBench campaigns using
// fresh Vercel Sandbox microVMs.
package vercel

import (
	"context"
	"crypto/rand"
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
	Region       = "iad1"
	remoteBinary = "/vercel/sandbox/providerbench"
)

var valuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Config describes one Vercel Sandbox measurement cohort.
type Config struct {
	Campaign       string
	Count          int
	Repeats        int
	VCPUs          int
	Runtime        string
	PriceHour      float64
	PriceMonth     float64
	Binary         string
	OutputDir      string
	Tests          string
	Quick          bool
	PricingAsOf    string
	PricingBasis   string
	SandboxTimeout time.Duration
	CommandTimeout time.Duration
}

// CreateOptions describes a fresh Sandbox instance.
type CreateOptions struct {
	Name    string
	VCPUs   int
	Runtime string
	Timeout time.Duration
	Tags    map[string]string
}

// Client is the Vercel Sandbox transport used by Runner.
type Client interface {
	Preflight(context.Context) error
	Version(context.Context) (string, error)
	Create(context.Context, CreateOptions) error
	CopyTo(context.Context, string, string, string) error
	Exec(context.Context, string, time.Duration, string, []string) error
	CopyFrom(context.Context, string, string, string) error
	Remove(context.Context, string) error
}

// Runner creates and removes one fresh Sandbox for every sample. Repeats on a
// sample share that Sandbox and are reduced to one per-sample median by the site.
type Runner struct {
	Client   Client
	Out      io.Writer
	Now      func() time.Time
	NewRunID func() (string, error)
}

// Validate checks inputs before Vercel is contacted.
func Validate(cfg Config) error {
	var problems []error
	required := []struct {
		name  string
		value string
	}{
		{"campaign", cfg.Campaign},
		{"runtime", cfg.Runtime},
		{"binary", cfg.Binary},
		{"output-dir", cfg.OutputDir},
		{"pricing-basis", cfg.PricingBasis},
	}
	for _, field := range required {
		if strings.TrimSpace(field.value) == "" {
			problems = append(problems, fmt.Errorf("--%s is required", field.name))
		}
	}
	if cfg.Runtime != "" && !valuePattern.MatchString(cfg.Runtime) {
		problems = append(problems, errors.New("--runtime contains unsupported characters"))
	}
	if cfg.Count < 1 || cfg.Count > 100 {
		problems = append(problems, errors.New("--count must be from 1 to 100"))
	}
	if cfg.Repeats < 1 || cfg.Repeats > 10 {
		problems = append(problems, errors.New("--repeats must be from 1 to 10"))
	}
	if cfg.VCPUs < 1 || cfg.VCPUs > 32 {
		problems = append(problems, errors.New("--vcpus must be from 1 to 32"))
	}
	if cfg.PriceHour <= 0 || math.IsNaN(cfg.PriceHour) || math.IsInf(cfg.PriceHour, 0) {
		problems = append(problems, errors.New("--price-hour must be a finite number greater than zero"))
	}
	if cfg.PriceMonth <= 0 || math.IsNaN(cfg.PriceMonth) || math.IsInf(cfg.PriceMonth, 0) {
		problems = append(problems, errors.New("--price-month must be a finite number greater than zero"))
	}
	if cfg.SandboxTimeout <= 0 {
		problems = append(problems, errors.New("--sandbox-timeout must be greater than zero"))
	}
	if cfg.CommandTimeout <= 0 || cfg.CommandTimeout > cfg.SandboxTimeout {
		problems = append(problems, errors.New("--command-timeout must be positive and no longer than --sandbox-timeout"))
	}
	if cfg.PricingAsOf != "" {
		if _, err := time.Parse(time.DateOnly, cfg.PricingAsOf); err != nil {
			problems = append(problems, errors.New("--pricing-as-of must use YYYY-MM-DD"))
		}
	}
	return errors.Join(problems...)
}

// Describe prints a no-API execution plan.
func Describe(w io.Writer, cfg Config, project, scope string) {
	total := cfg.Count * cfg.Repeats
	fmt.Fprintln(w, "Vercel Sandbox campaign dry run")
	fmt.Fprintf(w, "  campaign:       %s\n", cfg.Campaign)
	fmt.Fprintf(w, "  configuration:  %d vCPU / %d GB, %s, %s\n", cfg.VCPUs, cfg.VCPUs*2, cfg.Runtime, Region)
	fmt.Fprintf(w, "  samples:        %d fresh Sandboxes, created and removed sequentially\n", cfg.Count)
	fmt.Fprintf(w, "  measurements:   %d repeats per Sandbox, %d reports total\n", cfg.Repeats, total)
	fmt.Fprintf(w, "  output:         %s\n", cfg.OutputDir)
	fmt.Fprintf(w, "  equivalent cost: %.6f EUR/hour, %.4f EUR/month\n", cfg.PriceHour, cfg.PriceMonth)
	if project != "" {
		fmt.Fprintf(w, "  project:        %s\n", project)
	}
	if scope != "" {
		fmt.Fprintf(w, "  scope:          %s\n", scope)
	}
	fmt.Fprintln(w, "  lifecycle:      preflight, create fresh Sandbox, upload, repeat, validate reports, remove")
	fmt.Fprintln(w, "No Vercel request was made and no Sandbox was created.")
}

// Run executes a full fresh-Sandbox cohort.
func (r Runner) Run(ctx context.Context, cfg Config) (runErr error) {
	if err := Validate(cfg); err != nil {
		return err
	}
	if r.Client == nil {
		return errors.New("Vercel campaign runner requires a client")
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
	newRunID := r.NewRunID
	if newRunID == nil {
		newRunID = randomRunID
	}
	runID, err := newRunID()
	if err != nil {
		return fmt.Errorf("create campaign run ID: %w", err)
	}
	if err := os.MkdirAll(cfg.OutputDir, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	if err := ensureReportPathsAvailable(cfg); err != nil {
		return err
	}
	if err := r.Client.Preflight(ctx); err != nil {
		return fmt.Errorf("Vercel Sandbox preflight: %w", err)
	}
	cliVersion, err := r.Client.Version(ctx)
	if err != nil {
		return fmt.Errorf("detect Vercel CLI version: %w", err)
	}

	active := make(map[string]struct{})
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		var cleanupErrs []error
		for name := range active {
			fmt.Fprintf(out, "cleanup: removing Vercel Sandbox %s\n", name)
			if err := r.Client.Remove(cleanupCtx, name); err != nil {
				cleanupErrs = append(cleanupErrs, fmt.Errorf("remove Sandbox %s: %w", name, err))
			}
		}
		if cleanupErr := errors.Join(cleanupErrs...); cleanupErr != nil {
			runErr = errors.Join(runErr, fmt.Errorf("cleanup incomplete: %w", cleanupErr))
		}
	}()

	completed := 0
	for sample := 1; sample <= cfg.Count; sample++ {
		name := sandboxName(cfg, runID, sample)
		active[name] = struct{}{}
		fmt.Fprintf(out, "\ncreating fresh Vercel Sandbox %d/%d: %s\n", sample, cfg.Count, name)
		if err := r.Client.Create(ctx, CreateOptions{
			Name:    name,
			VCPUs:   cfg.VCPUs,
			Runtime: cfg.Runtime,
			Timeout: cfg.SandboxTimeout,
			Tags: map[string]string{
				"managed_by":   "providerbench",
				"campaign":     campaignSlug(cfg.Campaign),
				"sample_index": strconv.Itoa(sample),
			},
		}); err != nil {
			return fmt.Errorf("create Vercel Sandbox %s: %w", name, err)
		}
		if err := r.Client.CopyTo(ctx, name, cfg.Binary, remoteBinary); err != nil {
			return fmt.Errorf("copy benchmark to %s: %w", name, err)
		}
		if err := r.Client.Exec(ctx, name, time.Minute, "/bin/chmod", []string{"+x", remoteBinary}); err != nil {
			return fmt.Errorf("make benchmark executable on %s: %w", name, err)
		}

		for repeat := 1; repeat <= cfg.Repeats; repeat++ {
			fmt.Fprintf(out, "running sample %d/%d repeat %d/%d\n", sample, cfg.Count, repeat, cfg.Repeats)
			remoteReport := remoteReportPath(cfg, sample, repeat)
			args := benchmarkArgs(cfg, cliVersion, sample, repeat, remoteReport)
			if err := r.Client.Exec(ctx, name, cfg.CommandTimeout, remoteBinary, args); err != nil {
				return fmt.Errorf("benchmark sample %d repeat %d: %w", sample, repeat, err)
			}
			localReport := localReportPath(cfg, sample, repeat)
			partialReport := localReport + ".partial"
			if err := r.Client.CopyFrom(ctx, name, remoteReport, partialReport); err != nil {
				// A truncated partial would otherwise block the retry as a
				// report-path collision.
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

		if err := r.Client.Remove(ctx, name); err != nil {
			return fmt.Errorf("remove completed Vercel Sandbox %s: %w", name, err)
		}
		delete(active, name)
	}

	expected := cfg.Count * cfg.Repeats
	if completed != expected {
		return fmt.Errorf("campaign incomplete: expected %d reports, saved %d", expected, completed)
	}
	fmt.Fprintf(out, "\ncampaign complete: %s, %d fresh Vercel Sandboxes, %d reports\n",
		cfg.Campaign, cfg.Count, completed)
	return nil
}

func benchmarkArgs(cfg Config, cliVersion string, sample, repeat int, report string) []string {
	plan := planName(cfg)
	args := []string{
		"run",
		"--provider", "vercel",
		"--product", "Sandbox",
		"--plan", plan,
		"--tier", "usage-based",
		"--region", Region,
		"--price-hour", strconv.FormatFloat(cfg.PriceHour, 'f', -1, 64),
		"--price-month", strconv.FormatFloat(cfg.PriceMonth, 'f', -1, 64),
		"--campaign", cfg.Campaign,
		"--sample-index", strconv.Itoa(sample),
		"--repeat-index", strconv.Itoa(repeat),
		"--fresh-instance",
		"--env", "runtime=" + cfg.Runtime,
		"--env", "sandbox_vcpus=" + strconv.Itoa(cfg.VCPUs),
		"--env", "sandbox_memory_gb=" + strconv.Itoa(cfg.VCPUs*2),
		"--env", "vercel_cli_version=" + cliVersion,
		"--env", "pricing_as_of=" + cfg.PricingAsOf,
		"--env", "pricing_basis=" + cfg.PricingBasis,
		"--env", "host_strategy=fresh-vercel-sandbox-per-sample",
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

func planName(cfg Config) string {
	return fmt.Sprintf("%d vCPU / %d GB", cfg.VCPUs, cfg.VCPUs*2)
}

func localReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("vercel-sandbox-%dvcpu-%s-%s-%d-%d.json",
		cfg.VCPUs, Region, campaignSlug(cfg.Campaign), sample, repeat)
	return filepath.Join(cfg.OutputDir, name)
}

func remoteReportPath(cfg Config, sample, repeat int) string {
	name := fmt.Sprintf("providerbench-%s-%d-%d.json", campaignSlug(cfg.Campaign), sample, repeat)
	return filepath.ToSlash(filepath.Join("/vercel/sandbox", name))
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

func sandboxName(cfg Config, runID string, sample int) string {
	return resourceName("pb", campaignSlug(cfg.Campaign), runID, strconv.Itoa(sample))
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

func randomRunID() (string, error) {
	var value [4]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(value[:]), nil
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
	var report reportIdentity
	if err := json.Unmarshal(data, &report); err != nil {
		return fmt.Errorf("copied report %s is invalid JSON: %w", path, err)
	}
	if report.Provider.Name != "vercel" ||
		report.Provider.Product != "Sandbox" ||
		report.Provider.Plan != planName(cfg) ||
		report.Provider.Region != Region ||
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
