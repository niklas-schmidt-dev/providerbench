package workload

import (
	"context"
	"fmt"
	"strconv"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(kvTest{}) }

// kvTest looks up string keys in a large in-memory hash map — the access
// pattern of caches, session stores and join tables. The map is far larger
// than the CPU caches, so most lookups pay a DRAM round trip on top of
// hashing and comparing the key.
type kvTest struct{}

func (kvTest) Name() string     { return "kv" }
func (kvTest) Category() string { return Category }
func (kvTest) Description() string {
	return "String-keyed lookups in a 1M-entry in-memory map, one core and all cores"
}

const (
	kvEntries = 1 << 20
	kvBatch   = 4096
)

func (kvTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("kv")
	opts.Logf("kv: building a %d-entry map...", kvEntries)
	keys := make([]string, kvEntries)
	index := make(map[string]uint32, kvEntries)
	for i := range keys {
		keys[i] = "session:" + strconv.FormatUint(uint64(i)*2654435761%4294967291, 36) + ":user"
		index[keys[i]] = uint32(i)
	}
	if len(index) != kvEntries {
		return nil, fmt.Errorf("kv: key generator collided (%d distinct keys)", len(index))
	}

	// The map is only read after this point, so workers share it safely —
	// like a warmed cache serving concurrent requests.
	worker := uint64(0)
	newWork := func() func() (int64, error) {
		worker++
		state := worker * 0x9E3779B97F4A7C15 // per-worker xorshift stream
		return func() (int64, error) {
			for range kvBatch {
				state ^= state << 13
				state ^= state >> 7
				state ^= state << 17
				want := uint32(state % kvEntries)
				if got, ok := index[keys[want]]; !ok || got != want {
					return 0, fmt.Errorf("lookup of key %d returned %d (found %v)", want, got, ok)
				}
			}
			return kvBatch, nil
		}
	}

	if err := scaled(ctx, opts, res, "Mops/s", 1e-6, newWork); err != nil {
		return nil, fmt.Errorf("kv: %w", err)
	}
	res.Note("random lookups of ~20-byte string keys in a shared %d-entry map; every result is checked", kvEntries)
	res.Finish()
	return res, ctx.Err()
}
