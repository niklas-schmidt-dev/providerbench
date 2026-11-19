package workload

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"slices"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(sortTest{}) }

// sortTest sorts random 64-bit keys: branch-heavy, cache-bound work that no
// instruction-set extension accelerates.
type sortTest struct{}

func (sortTest) Name() string     { return "sort" }
func (sortTest) Category() string { return Category }
func (sortTest) Description() string {
	return "Sorting random 64-bit keys, one core and all cores"
}

const sortKeys = 1 << 20 // 8 MiB per worker, beyond a core's private cache

func (sortTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("sort")
	rng := rand.New(rand.NewSource(11))
	keys := make([]uint64, sortKeys)
	for i := range keys {
		keys[i] = rng.Uint64()
	}

	newWork := func() func() (int64, error) {
		scratch := make([]uint64, len(keys))
		verified := false
		return func() (int64, error) {
			copy(scratch, keys)
			slices.Sort(scratch)
			if !verified {
				if !slices.IsSorted(scratch) {
					return 0, errors.New("output is not sorted")
				}
				verified = true
			}
			if scratch[0] > scratch[len(scratch)-1] {
				return 0, errors.New("output is not sorted")
			}
			return int64(len(scratch)), nil
		}
	}

	if err := scaled(ctx, opts, res, "Mkeys/s", 1e-6, newWork); err != nil {
		return nil, fmt.Errorf("sort: %w", err)
	}
	res.Note("pattern-defeating quicksort over %d random uint64 keys per pass, fixed seed", sortKeys)
	res.Finish()
	return res, ctx.Err()
}
