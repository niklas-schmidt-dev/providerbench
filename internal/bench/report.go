package bench

import (
	"encoding/json"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
)

const SchemaVersion = 1

// Provider describes where the benchmark ran. All fields are user-supplied.
// Name is the company (hetzner, vercel, aws); Product is the specific
// offering tested (cloud-vps, sandbox, ec2) — one company can have many.
type Provider struct {
	Name          string  `json:"name,omitempty"`
	Product       string  `json:"product,omitempty"`
	Plan          string  `json:"plan,omitempty"`
	Region        string  `json:"region,omitempty"`
	PriceEURMonth float64 `json:"price_eur_month,omitempty"`
}

// Report is the full output of a run — this is what gets submitted to the
// public dataset. Its shape is described in schema/result.schema.json.
type Report struct {
	SchemaVersion int    `json:"schema_version"`
	CLIVersion    string `json:"cli_version"`
	// Category groups reports on providerbench.dev: "compute" for this CLI's
	// built-in tests; future suites (ai, storage, ...) use their own.
	Category  string       `json:"category"`
	CreatedAt time.Time    `json:"created_at"`
	Sample    bool         `json:"sample,omitempty"` // true = illustrative data, not a real measurement
	Provider  Provider     `json:"provider"`
	System    sysinfo.Info `json:"system"`
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
