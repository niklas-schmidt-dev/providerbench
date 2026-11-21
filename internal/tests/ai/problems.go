package ai

import (
	"fmt"
	"hash/fnv"
)

const (
	// levels is how many difficulty steps a family has, perLevel how many
	// problems each step holds. Both are part of the protocol.
	levels   = 5
	perLevel = 8
	// quickPerLevel is the smaller set a --quick run asks.
	quickPerLevel = 2
)

// problem is one task before it is put into a language. The same problem is
// posed in every language, so a difference in the results is a difference in
// how the model handles the language, not in what was asked.
type problem interface {
	text(l *language) string
	solution() answer
}

// answer is the expected result, independent of language.
type answer struct {
	hint   hintKind
	number int // hintNumber
	choice int // every other hint: index into that hint's vocabulary
}

// family is one kind of task.
type family struct {
	name        string
	description string
	generate    func(r *rng, level int) problem
}

var families = []family{
	{"arithmetic", "Multi-step stock keeping with every quantity spelled out in words", newArithmetic},
	{"ordering", "Deduce a full order from shuffled pairwise comparisons", newOrdering},
	{"reading", "Follow a chain of facts through a shuffled text to one detail", newReading},
	{"procedure", "Carry out a written list procedure step by step", newProcedure},
	{"calendar", "Find the weekday of a date from the weekday of another", newCalendar},
}

// problems returns a family's problems in protocol order: perLevel at level
// one, then level two, and so on. A quick run takes the first few of each
// level, so its problems are a subset of the full set, never different ones.
func (f family) problems(quick bool) []problem {
	take := perLevel
	if quick {
		take = quickPerLevel
	}
	out := make([]problem, 0, levels*take)
	for level := 1; level <= levels; level++ {
		for i := range take {
			index := (level-1)*perLevel + i
			out = append(out, f.generate(newRNG(f.name, index), level))
		}
	}
	return out
}

// prompt is the full message a model receives for one problem.
func prompt(p problem, l *language) string {
	return p.text(l) + "\n\n" + l.instruction + "\n" + l.hints[p.solution().hint]
}

// seed is the protocol's problem set identity. Changing it, or anything a
// generator draws, changes every problem and needs a new protocol version.
const seed = "ai-language-v1"

// rng is a splitmix64 generator. The problem set must be identical on every
// machine and Go release, so it does not lean on a library generator.
type rng struct{ state uint64 }

// newRNG starts the stream of one problem. The index is hashed in, not added:
// the generator steps its state by a constant, so streams whose starts differ
// by a multiple of that constant would be one stream read at an offset.
func newRNG(family string, index int) *rng {
	h := fnv.New64a()
	fmt.Fprintf(h, "%s/%s/%d", seed, family, index)
	return &rng{state: h.Sum64()}
}

func (r *rng) next() uint64 {
	r.state += 0x9e3779b97f4a7c15
	z := r.state
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// intn returns a number in [0, n).
func (r *rng) intn(n int) int {
	return int(r.next() % uint64(n))
}

// between returns a number in [low, high].
func (r *rng) between(low, high int) int {
	return low + r.intn(high-low+1)
}

// perm returns the numbers 0..n-1 in random order.
func (r *rng) perm(n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	for i := n - 1; i > 0; i-- {
		j := r.intn(i + 1)
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// shuffle puts s into random order.
func shuffle[T any](r *rng, s []T) {
	for i := len(s) - 1; i > 0; i-- {
		j := r.intn(i + 1)
		s[i], s[j] = s[j], s[i]
	}
}

// pick returns a number in [low, high] that passes ok, or false when the
// range holds none.
func (r *rng) pick(low, high int, ok func(int) bool) (int, bool) {
	if low > high {
		return 0, false
	}
	for range 16 {
		if n := r.between(low, high); ok(n) {
			return n, true
		}
	}
	for n := low; n <= high; n++ {
		if ok(n) {
			return n, true
		}
	}
	return 0, false
}
