// Package digitalocean orchestrates reproducible ProviderBench campaigns on
// fresh DigitalOcean Basic Droplets.
package digitalocean

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
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	hetznercampaign "github.com/niklas-schmidt-dev/providerbench/internal/campaign/hetzner"
)

const (
	Region       = "fra1"
	requiredVCPU = 2
	requiredRAM  = 4096
	hostCount    = 10
	repeatCount  = 3
	remoteBinary = "/usr/local/bin/providerbench"
)

var providerValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// Server and Remote intentionally reuse the provider-neutral SSH transport
// shape already exercised by the Hetzner runner.
type Server = hetznercampaign.Server
type Remote = hetznercampaign.Remote

// NewOpenSSH creates the isolated OpenSSH transport used by real campaigns.
func NewOpenSSH(privateKey string, stdout, stderr io.Writer) (*hetznercampaign.OpenSSH, func(), error) {
	return hetznercampaign.NewOpenSSH(privateKey, stdout, stderr)
}

type Config struct {
	Campaign          string
	SSHKeyFingerprint string
	SSHPrivateKey     string
	Image             string
	Binary            string
	OutputDir         string
	PricingAsOf       string
	USDToEUR          float64
	SSHTimeout        time.Duration
}

// Size is the provider price-and-capacity data used to select the campaign
// plan. Prices are the USD list prices returned by DigitalOcean.
type Size struct {
	Slug         string
	Description  string
	Memory       int
	VCPUs        int
	PriceHourly  float64
	PriceMonthly float64
	Regions      []string
	Available    bool
}

type CreateDropletsOptions struct {
	Names             []string
	Region            string
	Size              string
	Image             string
	SSHKeyFingerprint string
	Tags              []string
}

// Cloud owns all billable-resource operations. Multi-create ensures all ten
// Droplets are requested together before measurement starts.
type Cloud interface {
	ListSizes(context.Context) ([]Size, error)
	CreateDroplets(context.Context, CreateDropletsOptions) ([]Server, error)
	DeleteDroplet(context.Context, Server) error
	DeleteDropletsByTag(context.Context, string) error
}

type Runner struct {
	Cloud  Cloud
	Remote Remote
	Out    io.Writer
	Now    func() time.Time
}

func Validate(cfg Config) error {
	var problems []error
	for _, field := range []struct {
		name  string
		value string
	}{
		{"campaign", cfg.Campaign},
		{"ssh-key-fingerprint", cfg.SSHKeyFingerprint},
		{"ssh-private-key", cfg.SSHPrivateKey},
		{"image", cfg.Image},
		{"binary", cfg.Binary},
		{"output-dir", cfg.OutputDir},
	} {
		if strings.TrimSpace(field.value) == "" {
			problems = append(problems, fmt.Errorf("--%s is required", field.name))
		}
	}
	if cfg.Image != "" && !providerValuePattern.MatchString(cfg.Image) {
		problems = append(problems, errors.New("--image contains unsupported characters"))
	}
	if cfg.USDToEUR <= 0 || math.IsNaN(cfg.USDToEUR) || math.IsInf(cfg.USDToEUR, 0) {
		problems = append(problems, errors.New("--usd-to-eur must be a finite EUR-per-USD rate greater than zero"))
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

// SelectSize returns the cheapest available shared-CPU Basic Droplet with
// exactly 2 vCPUs and 4096 MiB in fra1.
func SelectSize(sizes []Size) (Size, error) {
	var candidates []Size
	for _, size := range sizes {
		if size.Available &&
			size.VCPUs == requiredVCPU &&
			size.Memory == requiredRAM &&
			strings.EqualFold(strings.TrimSpace(size.Description), "Basic") &&
			slices.Contains(size.Regions, Region) &&
			size.PriceHourly > 0 &&
			size.PriceMonthly > 0 {
			candidates = append(candidates, size)
		}
	}
	if len(candidates) == 0 {
		return Size{}, fmt.Errorf(
			"no available DigitalOcean Basic size with exactly %d vCPUs and %d MiB in %s",
			requiredVCPU,
			requiredRAM,
			Region,
		)
	}
	slices.SortFunc(candidates, func(a, b Size) int {
		if byMonth := cmpFloat(a.PriceMonthly, b.PriceMonthly); byMonth != 0 {
			return byMonth
		}
		if byHour := cmpFloat(a.PriceHourly, b.PriceHourly); byHour != 0 {
			return byHour
		}
		return strings.Compare(a.Slug, b.Slug)
	})
	return candidates[0], nil
}

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

func Describe(w io.Writer, cfg Config) {
	fmt.Fprintln(w, "DigitalOcean campaign dry run")
	fmt.Fprintf(w, "  campaign:       %s\n", cfg.Campaign)
	fmt.Fprintf(w, "  selection:      cheapest available Basic size with exactly 2 vCPUs / 4096 MiB in %s\n", Region)
	fmt.Fprintf(w, "  hosts:          %d fresh, tagged Droplets requested together\n", hostCount)
	fmt.Fprintf(w, "  measurements:   %d repeats per host, %d reports total\n", repeatCount, hostCount*repeatCount)
	fmt.Fprintf(w, "  image:           %s\n", cfg.Image)
	fmt.Fprintf(w, "  output:          %s\n", cfg.OutputDir)
	fmt.Fprintf(w, "  conversion:      1 USD = %.8f EUR, observed %s\n", cfg.USDToEUR, cfg.PricingAsOf)
	fmt.Fprintln(w, "  lifecycle:      select size via API, create all Droplets, benchmark sequentially, destroy every Droplet")
	fmt.Fprintln(w, "The exact size and list price are resolved only during a confirmed run.")
	fmt.Fprintln(w, "No API request was made and no resource was created.")
}

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

	sizes, err := r.Cloud.ListSizes(ctx)
	if err != nil {
		return fmt.Errorf("list DigitalOcean sizes: %w", err)
	}
	size, err := SelectSize(sizes)
	if err != nil {
		return err
	}
	fmt.Fprintf(
		out,
		"selected %s: %.6f USD/hour, %.2f USD/month (%.6f EUR/hour, %.2f EUR/month)\n",
		size.Slug,
		size.PriceHourly,
		size.PriceMonthly,
		size.PriceHourly*cfg.USDToEUR,
		size.PriceMonthly*cfg.USDToEUR,
	)
	fmt.Fprintf(
		out,
		"maximum live fleet rate: %.6f USD/hour (%.6f EUR/hour) while all %d Droplets exist\n",
		size.PriceHourly*hostCount,
		size.PriceHourly*cfg.USDToEUR*hostCount,
		hostCount,
	)

	names := make([]string, 0, hostCount)
	for sample := 1; sample <= hostCount; sample++ {
		names = append(names, dropletName(cfg, sample))
	}
	campaignTag := "providerbench-" + campaignSlug(cfg.Campaign)
	tags := []string{"providerbench", campaignTag}
	fmt.Fprintf(out, "creating %d tagged Droplets together in %s\n", hostCount, Region)
	provisionCtx, cancelProvision := context.WithTimeout(ctx, 10*time.Minute)
	servers, createErr := r.Cloud.CreateDroplets(provisionCtx, CreateDropletsOptions{
		Names:             names,
		Region:            Region,
		Size:              size.Slug,
		Image:             cfg.Image,
		SSHKeyFingerprint: cfg.SSHKeyFingerprint,
		Tags:              tags,
	})
	cancelProvision()
	active := make(map[int64]Server, len(servers))
	for _, server := range servers {
		if server.ID != 0 {
			active[server.ID] = server
		}
	}
	defer func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		var cleanupErrs []error
		for _, server := range active {
			fmt.Fprintf(out, "cleanup: destroying %s\n", server.Name)
			if err := r.Cloud.DeleteDroplet(cleanupCtx, server); err != nil {
				cleanupErrs = append(cleanupErrs, fmt.Errorf("destroy Droplet %s: %w", server.Name, err))
			}
		}
		// Multi-create may have committed resources even when the client did
		// not receive every Droplet ID. The unique campaign tag is the final
		// cleanup backstop for those ambiguous API outcomes.
		if err := r.Cloud.DeleteDropletsByTag(cleanupCtx, campaignTag); err != nil {
			cleanupErrs = append(cleanupErrs, fmt.Errorf("destroy Droplets tagged %s: %w", campaignTag, err))
		}
		if cleanupErr := errors.Join(cleanupErrs...); cleanupErr != nil {
			runErr = errors.Join(runErr, fmt.Errorf("cleanup incomplete: %w", cleanupErr))
		}
	}()
	if createErr != nil {
		return fmt.Errorf("create DigitalOcean Droplets: %w", createErr)
	}
	if len(servers) != hostCount {
		return fmt.Errorf("DigitalOcean returned %d Droplets, expected %d", len(servers), hostCount)
	}
	for index, server := range servers {
		if server.ID == 0 || server.IPv4 == "" {
			return fmt.Errorf("Droplet %d has no ID or public IPv4 after provisioning", index+1)
		}
	}

	completed := 0
	for sample, server := range servers {
		sampleIndex := sample + 1
		fmt.Fprintf(out, "\n=== ACTIVE HOST %d/%d: %s (%s) ===\n", sampleIndex, hostCount, server.Name, server.IPv4)
		if err := r.Remote.WaitReady(ctx, server, cfg.SSHTimeout); err != nil {
			return fmt.Errorf("wait for SSH on %s: %w", server.Name, err)
		}
		if err := r.Remote.CopyBinary(ctx, server, cfg.Binary, remoteBinary); err != nil {
			return fmt.Errorf("copy benchmark to %s: %w", server.Name, err)
		}
		for repeat := 1; repeat <= repeatCount; repeat++ {
			fmt.Fprintf(out, "running repeat %d/%d on host %d/%d\n", repeat, repeatCount, sampleIndex, hostCount)
			remoteReport := remoteReportPath(cfg, size, sampleIndex, repeat)
			args := benchmarkArgs(cfg, size, sampleIndex, repeat, remoteReport)
			if err := r.Remote.Run(ctx, server, remoteBinary, args); err != nil {
				return fmt.Errorf("benchmark %s sample %d repeat %d: %w", size.Slug, sampleIndex, repeat, err)
			}
			localReport := localReportPath(cfg, size.Slug, sampleIndex, repeat)
			partialReport := localReport + ".partial"
			if err := r.Remote.CopyReport(ctx, server, remoteReport, partialReport); err != nil {
				_ = os.Remove(partialReport)
				return fmt.Errorf("copy report for sample %d repeat %d: %w", sampleIndex, repeat, err)
			}
			if err := verifyReport(partialReport, cfg, size, sampleIndex, repeat); err != nil {
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
		if err := r.Cloud.DeleteDroplet(ctx, server); err != nil {
			return fmt.Errorf("destroy completed Droplet %s: %w", server.Name, err)
		}
		delete(active, server.ID)
	}

	if completed != hostCount*repeatCount {
		return fmt.Errorf("campaign incomplete: expected %d reports, saved %d", hostCount*repeatCount, completed)
	}
	fmt.Fprintf(out, "\ncampaign complete: %s %s %s, %d independent hosts, %d reports\n",
		cfg.Campaign, size.Slug, Region, hostCount, completed)
	return nil
}

func benchmarkArgs(cfg Config, size Size, sample, repeat int, report string) []string {
	pricingBasis := fmt.Sprintf(
		"DigitalOcean API USD list price converted at 1 USD=%.8f EUR; net excluding VAT; transfer overages excluded",
		cfg.USDToEUR,
	)
	return []string{
		"run",
		"--provider", "digitalocean",
		"--product", "droplet-basic",
		"--plan", size.Slug,
		"--tier", "cheap",
		"--region", Region,
		"--price-hour", strconv.FormatFloat(size.PriceHourly*cfg.USDToEUR, 'f', -1, 64),
		"--price-month", strconv.FormatFloat(size.PriceMonthly*cfg.USDToEUR, 'f', -1, 64),
		"--campaign", cfg.Campaign,
		"--sample-index", strconv.Itoa(sample),
		"--repeat-index", strconv.Itoa(repeat),
		"--fresh-instance",
		"--env", "os_image=" + cfg.Image,
		"--env", "pricing_as_of=" + cfg.PricingAsOf,
		"--env", "pricing_basis=" + pricingBasis,
		"--env", "price_source_currency=USD",
		"--env", "price_usd_hour=" + strconv.FormatFloat(size.PriceHourly, 'f', -1, 64),
		"--env", "price_usd_month=" + strconv.FormatFloat(size.PriceMonthly, 'f', -1, 64),
		"--env", "usd_to_eur=" + strconv.FormatFloat(cfg.USDToEUR, 'f', -1, 64),
		"--env", "host_strategy=digitalocean-tagged-multi-create",
		"--json", report,
	}
}

func verifyReport(path string, cfg Config, size Size, sample, repeat int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read copied report %s: %w", path, err)
	}
	validated, validationErrs := bench.ValidateReport(data)
	if len(validationErrs) > 0 {
		return fmt.Errorf("copied report %s fails the report contract: %v", path, errors.Join(validationErrs...))
	}
	if validated.ProtocolVersion != bench.ComputeProtocol || validated.Profile != bench.StandardProfile {
		return fmt.Errorf("copied report %s has unexpected protocol/profile", path)
	}
	var identity struct {
		Provider struct {
			Name    string `json:"name"`
			Product string `json:"product"`
			Plan    string `json:"plan"`
			Region  string `json:"region"`
		} `json:"provider"`
		Measurement struct {
			CampaignID    string `json:"campaign_id"`
			SampleIndex   int    `json:"sample_index"`
			RepeatIndex   int    `json:"repeat_index"`
			FreshInstance bool   `json:"fresh_instance"`
		} `json:"measurement"`
		CreatedAt   time.Time         `json:"created_at"`
		Environment map[string]string `json:"environment"`
		Results     []bench.Result    `json:"results"`
	}
	if err := json.Unmarshal(data, &identity); err != nil {
		return fmt.Errorf("copied report %s is invalid JSON: %w", path, err)
	}
	if identity.Provider.Name != "digitalocean" ||
		identity.Provider.Product != "droplet-basic" ||
		identity.Provider.Plan != size.Slug ||
		identity.Provider.Region != Region ||
		identity.Measurement.CampaignID != cfg.Campaign ||
		identity.Measurement.SampleIndex != sample ||
		identity.Measurement.RepeatIndex != repeat ||
		!identity.Measurement.FreshInstance {
		return fmt.Errorf("copied report %s has unexpected campaign identity", path)
	}
	if identity.CreatedAt.IsZero() || len(identity.Results) == 0 {
		return fmt.Errorf("copied report %s has no timestamp or benchmark results", path)
	}
	if identity.Environment["pricing_as_of"] != cfg.PricingAsOf ||
		identity.Environment["usd_to_eur"] != strconv.FormatFloat(cfg.USDToEUR, 'f', -1, 64) {
		return fmt.Errorf("copied report %s has no matching price provenance", path)
	}
	return nil
}

func ensureReportPathsAvailable(cfg Config) error {
	pattern := filepath.Join(
		cfg.OutputDir,
		fmt.Sprintf("digitalocean-droplet-basic-*-%s-%s-*.json*", Region, campaignSlug(cfg.Campaign)),
	)
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return fmt.Errorf("inspect report paths: %w", err)
	}
	if len(matches) > 0 {
		return fmt.Errorf("report already exists: %s (use a new --campaign ID to preserve history)", matches[0])
	}
	return nil
}

func localReportPath(cfg Config, plan string, sample, repeat int) string {
	name := fmt.Sprintf(
		"digitalocean-droplet-basic-%s-%s-%s-%d-%d.json",
		plan,
		Region,
		campaignSlug(cfg.Campaign),
		sample,
		repeat,
	)
	return filepath.Join(cfg.OutputDir, name)
}

func remoteReportPath(cfg Config, size Size, sample, repeat int) string {
	return filepath.ToSlash(filepath.Join(
		"/tmp",
		fmt.Sprintf("providerbench-%s-%s-%d-%d.json", campaignSlug(cfg.Campaign), size.Slug, sample, repeat),
	))
}

func dropletName(cfg Config, sample int) string {
	return resourceName("pb", campaignSlug(cfg.Campaign), Region, strconv.Itoa(sample))
}

func campaignSlug(value string) string {
	return resourceName(value)
}

func resourceName(parts ...string) string {
	const maxLength = 63
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.Join(parts, "-")) {
		allowed := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-'
		if allowed {
			builder.WriteRune(r)
			lastDash = r == '-'
		} else if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	value := strings.Trim(builder.String(), "-")
	if value == "" {
		value = "campaign"
	}
	if len(value) <= maxLength {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	suffix := hex.EncodeToString(sum[:4])
	return strings.TrimRight(value[:maxLength-len(suffix)-1], "-") + "-" + suffix
}
