package ai

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// The procedure family gives a list of numbers and a numbered list of steps
// written in the language. The list itself is digits; what has to be
// understood is the instructions.

const (
	listRemoveDivisible = iota
	listReverse
	listAdd
	listSwapEnds
	listSortDescending
	listSortAscending
	listRemoveLargest
	listRemoveSmallest
	listRemoveGreater
	listMultiply
	listKinds
)

const (
	askFirst = iota
	askLast
	askSum
	askCount
	askListKinds
)

// minList is the shortest list a step may leave: every question still has
// something to ask about.
const minList = 3

type listStep struct {
	kind int
	n    int
}

type procedureProblem struct {
	list  []int
	steps []listStep
	ask   int
	want  int
}

// apply carries out one step. The values of a list are distinct and every
// step keeps them distinct, so "the largest number" always names one number.
func (s listStep) apply(list []int) []int {
	out := slices.Clone(list)
	switch s.kind {
	case listRemoveDivisible:
		out = slices.DeleteFunc(out, func(v int) bool { return v%s.n == 0 })
	case listReverse:
		slices.Reverse(out)
	case listAdd:
		for i := range out {
			out[i] += s.n
		}
	case listSwapEnds:
		out[0], out[len(out)-1] = out[len(out)-1], out[0]
	case listSortDescending:
		slices.SortFunc(out, func(a, b int) int { return b - a })
	case listSortAscending:
		slices.Sort(out)
	case listRemoveLargest:
		out = slices.DeleteFunc(out, func(v int) bool { return v == slices.Max(list) })
	case listRemoveSmallest:
		out = slices.DeleteFunc(out, func(v int) bool { return v == slices.Min(list) })
	case listRemoveGreater:
		out = slices.DeleteFunc(out, func(v int) bool { return v > s.n })
	case listMultiply:
		for i := range out {
			out[i] *= s.n
		}
	}
	return out
}

func newProcedure(r *rng, level int) problem {
	return procedureOf(r, [levels]int{8, 12, 20, 30, 45}[level-1], [levels]int{5, 10, 15, 25, 40}[level-1], [levels]int{minList, 8, 12, 20, 30}[level-1])
}

// procedureOf builds a list of size numbers and count steps to apply to it.
// No step leaves fewer than floor numbers.
func procedureOf(r *rng, size, count, floor int) problem {
	p := &procedureProblem{}
	for _, v := range r.perm(59)[:size] {
		p.list = append(p.list, v+2) // distinct values from 2 to 60
	}
	list := p.list
	last := -1
	for len(p.steps) < count {
		step, ok := drawStep(r, list, last, floor)
		if !ok {
			continue
		}
		p.steps = append(p.steps, step)
		list = step.apply(list)
		last = step.kind
	}

	p.ask = r.intn(askListKinds)
	switch p.ask {
	case askFirst:
		p.want = list[0]
	case askLast:
		p.want = list[len(list)-1]
	case askSum:
		for _, v := range list {
			p.want += v
		}
	case askCount:
		p.want = len(list)
	}
	return p
}

// drawStep proposes one step that changes the list, leaves at least floor
// numbers and keeps every value within the range the number words cover.
func drawStep(r *rng, list []int, last, floor int) (listStep, bool) {
	step := listStep{kind: r.intn(listKinds)}
	if step.kind == last {
		return step, false
	}
	largest := slices.Max(list)
	switch step.kind {
	case listRemoveDivisible:
		step.n = r.between(2, 5)
	case listAdd:
		n, ok := r.pick(2, 20, standalone)
		if !ok || largest+n > 999 {
			return step, false
		}
		step.n = n
	case listMultiply:
		step.n = r.between(2, 3)
		if largest*step.n > 999 {
			return step, false
		}
	case listRemoveLargest, listRemoveSmallest:
		if len(list) <= floor {
			return step, false
		}
	case listRemoveGreater:
		// Keep the keep smallest numbers: the threshold sits between two
		// neighbours of the sorted list.
		sorted := slices.Sorted(slices.Values(list))
		if len(sorted) <= floor {
			return step, false
		}
		keep := r.between(floor, len(sorted)-1)
		n, ok := r.pick(sorted[keep-1], sorted[keep]-1, standalone)
		if !ok {
			return step, false
		}
		step.n = n
	}
	after := step.apply(list)
	if len(after) < floor || slices.Equal(after, list) {
		return step, false
	}
	return step, true
}

func (p *procedureProblem) text(l *language) string {
	t := l.procedure
	numbers := make([]string, len(p.list))
	for i, v := range p.list {
		numbers[i] = strconv.Itoa(v)
	}
	lines := []string{t.intro(strings.Join(numbers, t.separator))}
	for i, s := range p.steps {
		var sentence string
		switch s.kind {
		case listRemoveDivisible:
			sentence = t.removeDivisible(l.number(s.n))
		case listReverse:
			sentence = t.reverse
		case listAdd:
			sentence = t.add(l.number(s.n))
		case listSwapEnds:
			sentence = t.swapEnds
		case listSortDescending:
			sentence = t.sortDescending
		case listSortAscending:
			sentence = t.sortAscending
		case listRemoveLargest:
			sentence = t.removeLargest
		case listRemoveSmallest:
			sentence = t.removeSmallest
		case listRemoveGreater:
			sentence = t.removeGreater(l.number(s.n))
		case listMultiply:
			sentence = t.multiply(l.number(s.n))
		}
		lines = append(lines, fmt.Sprintf("%d. %s", i+1, sentence))
	}
	lines = append(lines, [askListKinds]string{t.askFirst, t.askLast, t.askSum, t.askCount}[p.ask])
	return strings.Join(lines, "\n")
}

func (p *procedureProblem) solution() answer {
	return answer{hint: hintNumber, number: p.want}
}
