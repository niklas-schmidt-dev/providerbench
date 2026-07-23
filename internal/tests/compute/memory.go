package compute

import (
	"context"
	"math/rand"
	"runtime"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(memTest{}) }

type memTest struct{}

func (memTest) Name() string { return "memory" }
func (memTest) Description() string {
	return "Sequential copy bandwidth and random-access latency (64 MiB pointer chase)"
}

func (memTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := newResult("memory")

	// Bandwidth: copy between two large buffers, well beyond any CPU cache.
	bufSize := 256 << 20 // 256 MiB
	if opts.Quick {
		bufSize = 128 << 20
	}
	opts.Logf("memory: copy bandwidth over %d MiB buffers...", bufSize>>20)
	src := make([]byte, bufSize)
	dst := make([]byte, bufSize)
	for i := range src {
		src[i] = byte(i)
	}
	copy(dst, src) // warm up page tables before timing

	var copied int64
	dur := opts.Pick(2*time.Second, 1*time.Second)
	deadline := time.Now().Add(dur)
	start := time.Now()
	for time.Now().Before(deadline) && ctx.Err() == nil {
		copied += int64(copy(dst, src))
	}
	gbps := float64(copied) / time.Since(start).Seconds() / 1e9

	// Latency: chase a random cycle through a 64 MiB index array. Every step
	// depends on the previous load, so this measures true access latency.
	const elems = 16 << 20 // 16M uint32 = 64 MiB
	opts.Logf("memory: random-access latency (64 MiB working set)...")
	chain := make([]uint32, elems)
	rng := rand.New(rand.NewSource(1)) // fixed seed: identical pattern on every machine
	perm := rng.Perm(elems)
	for i := range elems - 1 {
		chain[perm[i]] = uint32(perm[i+1])
	}
	chain[perm[elems-1]] = uint32(perm[0])

	var steps int64
	idx := uint32(0)
	latDur := opts.Pick(2*time.Second, 1*time.Second)
	deadline = time.Now().Add(latDur)
	start = time.Now()
	for time.Now().Before(deadline) && ctx.Err() == nil {
		for range 4096 {
			idx = chain[idx]
		}
		steps += 4096
	}
	nsPerAccess := float64(time.Since(start).Nanoseconds()) / float64(steps)
	runtime.KeepAlive(idx)

	res.Add("copy_bandwidth", gbps, "GB/s", true)
	res.Add("random_access_latency", nsPerAccess, "ns", false)
	res.Note("bandwidth counts bytes copied (read+write traffic is ~2x)")
	finish(res)
	return res, ctx.Err()
}
