package ai

import "strings"

// The ordering family states who is older than whom, one neighbouring pair
// at a time and in shuffled order, and asks for one place in the full line.

type ageFact struct {
	older, younger int  // people
	asYounger      bool // phrased from the younger person's side
}

type orderingProblem struct {
	byAge    []int // people, oldest first
	facts    []ageFact
	position int // counted from the youngest, starting at one
}

func newOrdering(r *rng, level int) problem {
	return orderingOf(r, [levels]int{5, 8, 12, 16, 20}[level-1])
}

// orderingOf builds a problem about size people.
func orderingOf(r *rng, size int) problem {
	p := &orderingProblem{byAge: r.perm(peopleCount)[:size]}
	// Only neighbouring pairs are stated: each one is needed, so no fact can
	// be skipped and the order is still unique.
	for i := range size - 1 {
		p.facts = append(p.facts, ageFact{
			older:     p.byAge[i],
			younger:   p.byAge[i+1],
			asYounger: r.intn(2) == 1,
		})
	}
	shuffle(r, p.facts)
	p.position = r.between(1, size)
	return p
}

func (p *orderingProblem) text(l *language) string {
	t := l.ordering
	lines := []string{t.intro}
	for _, f := range p.facts {
		if f.asYounger {
			lines = append(lines, t.younger(l.people[f.younger], l.people[f.older]))
		} else {
			lines = append(lines, t.older(l.people[f.older], l.people[f.younger]))
		}
	}
	lines = append(lines, t.ask(p.position))
	return strings.Join(lines, "\n")
}

func (p *orderingProblem) solution() answer {
	return answer{hint: hintPerson, choice: p.byAge[len(p.byAge)-p.position]}
}
