// Package reportschema exposes the versioned ProviderBench report contracts
// to the validator without requiring schema files beside the installed binary.
package reportschema

import "embed"

// Files contains every public report schema.
//
//go:embed *.json
var Files embed.FS
