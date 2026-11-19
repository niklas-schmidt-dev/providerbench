// Package workload contains application-shaped compute benchmarks: the work
// real services spend their CPU time on — compression, JSON, sorting, index
// lookups, allocation, TLS handshakes and HTTP serving.
//
// The compute suite's CPU test hashes with SHA-256, which is dominated by one
// instruction-set extension: two CPUs of similar general speed differ several
// times over depending on whether SHA-NI is present. The kernels here are
// ordinary compiled Go from the standard library, so no single extension
// decides a result; tls is real cryptography and uses what the CPU offers,
// as a web server does.
//
// Each test lives in its own file, implements bench.Benchmark and registers
// itself in init. The kernels verify their own output: a platform that
// computes the wrong answer fails instead of posting a fast number.
//
// The kernels are standard-library code, so their speed moves with the Go
// release that built the binary. Every report records that release as
// environment.go_version, and a cohort must come from one toolchain.
package workload

import (
	"context"
	"math/rand"
	"time"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
	"github.com/niklas-schmidt-dev/providerbench/internal/tests/kit"
)

// Category is the report category every test in this package belongs to.
const Category = "workload"

// Options is an alias so test files read naturally.
type Options = bench.Options

// phaseOverride shortens every measurement in unit tests; it is zero in the
// benchmark binary.
var phaseOverride time.Duration

// phase is how long each of the single-core and all-core measurements runs.
func phase(opts Options) time.Duration {
	if phaseOverride > 0 {
		return phaseOverride
	}
	return opts.Pick(3*time.Second, time.Second)
}

// scaled runs a kernel on one worker and then on every logical CPU and
// records both rates. scale converts the kernel's units per second into the
// published unit (for example bytes/s into MB/s).
func scaled(
	ctx context.Context,
	opts Options,
	res *bench.Result,
	unit string,
	scale float64,
	newWork func() func() (int64, error),
) error {
	d := phase(opts)
	cores := kit.Parallelism()

	opts.Logf("%s: one core (%s)...", res.Test, d)
	single, err := kit.Rate(ctx, d, 1, newWork)
	if err != nil {
		return err
	}
	opts.Logf("%s: all %d cores (%s)...", res.Test, cores, d)
	multi, err := kit.Rate(ctx, d, cores, newWork)
	if err != nil {
		return err
	}
	res.Add("single_core", single*scale, unit, true)
	res.Add("multi_core", multi*scale, unit, true)
	return nil
}

// skewed returns an index in [0, n) that favours small values: the product
// of two uniform draws. It is integer arithmetic only, so the sequence — and
// with it every generated input — is bit-identical on every architecture.
// Floating-point library functions are not: their last bit differs between
// CPUs.
func skewed(rng *rand.Rand, n int) int {
	return int(uint64(rng.Uint32()) * uint64(rng.Uint32()) >> 32 * uint64(n) >> 32)
}

// vocabulary is the fixed word list the text corpus draws from.
func vocabulary(rng *rand.Rand, words int) [][]byte {
	const letters = "etaoinshrdlucmfwypvbgkqjxz" // most frequent first
	vocab := make([][]byte, words)
	for i := range vocab {
		word := make([]byte, 2+rng.Intn(10))
		for j := range word {
			word[j] = letters[skewed(rng, len(letters))]
		}
		vocab[i] = word
	}
	return vocab
}

// textCorpus returns n bytes of deterministic, text-like data: words from a
// fixed vocabulary with a skewed frequency, broken into lines. It compresses
// roughly 3:1, like logs and markup, and is byte-identical on every machine.
func textCorpus(n int) []byte {
	rng := rand.New(rand.NewSource(20260724))
	vocab := vocabulary(rng, 4096)
	out := make([]byte, 0, n+16)
	for line := 0; len(out) < n; {
		// Skewing twice gives a long tail: a few words carry most of the
		// text, as in natural language.
		out = append(out, vocab[skewed(rng, 1+skewed(rng, len(vocab)))]...)
		line++
		if line%12 == 0 {
			out = append(out, '\n')
		} else {
			out = append(out, ' ')
		}
	}
	return out[:n]
}
