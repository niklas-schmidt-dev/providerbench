package workload

import (
	"context"
	"fmt"

	"github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(allocTest{}) }

// allocTest builds and discards trees of small heap objects. It is bound by
// the allocator, the garbage collector and fresh-memory bandwidth — the
// profile of services written for managed runtimes.
type allocTest struct{}

func (allocTest) Name() string     { return "alloc" }
func (allocTest) Category() string { return Category }
func (allocTest) Description() string {
	return "Allocating and collecting small-object trees, one worker and all cores"
}

const allocDepth = 16 // 131,071 nodes per tree

type allocNode struct {
	left, right *allocNode
	value       uint64
}

func buildTree(depth int, value uint64) *allocNode {
	node := &allocNode{value: value}
	if depth > 0 {
		node.left = buildTree(depth-1, value*2)
		node.right = buildTree(depth-1, value*2+1)
	}
	return node
}

func (n *allocNode) count() int64 {
	if n == nil {
		return 0
	}
	return 1 + n.left.count() + n.right.count()
}

func (allocTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
	res := bench.NewResult("alloc")
	const want = int64(1)<<(allocDepth+1) - 1

	newWork := func() func() (int64, error) {
		return func() (int64, error) {
			nodes := buildTree(allocDepth, 1).count()
			if nodes != want {
				return 0, fmt.Errorf("tree has %d nodes, want %d", nodes, want)
			}
			return nodes, nil
		}
	}

	if err := scaled(ctx, opts, res, "Mobjects/s", 1e-6, newWork); err != nil {
		return nil, fmt.Errorf("alloc: %w", err)
	}
	res.Note("binary trees of depth %d built, walked and dropped; 24-byte nodes", allocDepth)
	res.Note("single_core is one worker goroutine; the concurrent garbage collector may use other CPUs, as it does in production")
	res.Finish()
	return res, ctx.Err()
}
