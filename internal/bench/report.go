package bench

import (
	"encoding/json"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
)

const (
	LegacySchemaVersion = 1
	SchemaVersion       = 2
	ComputeProtocol     = "compute-v2"
	StorageProtocol     = "storage-v1"
	WorkloadProtocol    = "workload-v1"
	PlatformProtocol    = "platform-v1"
	ReachProtocol       = "reach-v1"
	AILanguageProtocol  = "ai-language-v1"
	StandardProfile     = "standard"
	SustainedProfile    = "sustained"

	// GoVersionKey is the environment entry that records the Go release a
	// benchmark binary was built with.
	GoVersionKey = "go_version"

	// SustainedWindow is the sampling window of the sustained profile.
	SustainedWindow = 10 * time.Second

	// MinSustainedDuration is the shortest sustained run: nine windows, so
	// the initial and the sustained segment do not overlap.
	MinSustainedDuration = 9 * SustainedWindow
)

// ProtocolFor returns the pinned protocol version for a category. The
// protocol is the immutable method identity: results are only comparable
// inside one protocol, so a category bumps it when its workload changes.
func ProtocolFor(category string) (string, bool) {
	switch category {
	case "compute":
		return ComputeProtocol, true
	case "storage":
		return StorageProtocol, true
	case "workload":
		return WorkloadProtocol, true
	case "platform":
		return PlatformProtocol, true
	case "reach":
		return ReachProtocol, true
	case "ai-language":
		return AILanguageProtocol, true
	}
	return "", false
}

// Provider describes where the benchmark ran. All fields are user-supplied.
// Name is the company (hetzner, vercel, aws); Product is the specific
// offering tested (cloud-vps, sandbox, ec2) — one company can have many.
type Provider struct {
	Name          string  `json:"name,omitempty"`
	Product       string  `json:"product,omitempty"`
	Plan          string  `json:"plan,omitempty"`
	Tier          string  `json:"tier,omitempty"`
	Region        string  `json:"region,omitempty"`
	PriceEURHour  float64 `json:"price_eur_hour,omitempty"`
	PriceEURMonth float64 `json:"price_eur_month,omitempty"`
}

// Measurement identifies repeated observations without exposing a hostname.
// A campaign can run the benchmark multiple times on each fresh instance.
// Consumers should first reduce repeats to one median per sample_index, then
// calculate percentiles across those independent hosts.
type Measurement struct {
	CampaignID           string `json:"campaign_id,omitempty"`
	SampleIndex          int    `json:"sample_index,omitempty"`
	RepeatIndex          int    `json:"repeat_index,omitempty"`
	FreshInstance        bool   `json:"fresh_instance,omitempty"`
	ExcludeFromAggregate bool   `json:"exclude_from_aggregate,omitempty"`
}

// Report is the full output of a run — this is what gets submitted to the
// public dataset. Its shape is described in schema/result.schema.json.
type Report struct {
	SchemaVersion   int    `json:"schema_version"`
	ProtocolVersion string `json:"protocol_version,omitempty"`
	Profile         string `json:"profile,omitempty"`
	CLIVersion      string `json:"cli_version"`
	// Category groups reports on providerbench.dev: "compute" for the
	// original suite; storage, workload, platform, reach and ai-language carry
	// their own pinned protocols (see ProtocolFor).
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"created_at"`
	Sample    bool      `json:"sample,omitempty"` // true = illustrative data, not a real measurement
	// Quick marks reports produced with --quick. Quick workloads are smaller
	// and shorter, so their numbers are not comparable to full runs and are
	// excluded from ranked aggregates.
	Quick       bool         `json:"quick,omitempty"`
	Provider    Provider     `json:"provider"`
	System      sysinfo.Info `json:"system"`
	Measurement Measurement  `json:"measurement"`
	// Environment holds user-supplied reproducibility detail beyond what
	// sysinfo detects: OS image, database versions, config choices, ...
	Environment map[string]string `json:"environment,omitempty"`
	Results     []Result          `json:"results"`
}

func (r *Report) JSON() ([]byte, error) {
	out, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}
