package bench

import (
	"encoding/json"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/sysinfo"
)

const SchemaVersion = 1

// Provider describes where the benchmark ran. All fields are user-supplied.
type Provider struct {
	Name          string  `json:"name,omitempty"`
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
	Results   []Result     `json:"results"`
}

func (r *Report) JSON() ([]byte, error) {
	out, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}
