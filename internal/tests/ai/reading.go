package ai

import "strings"

// The reading family is a short text of shuffled facts about people: where
// each lives, which colour each likes, and to whom each writes. The question
// follows the letters for a number of steps and asks one detail about the
// person reached, so the answer has to be collected across the whole text.

const (
	factLives = iota
	factLikes
	factWrites
	factKinds
)

type personFact struct {
	kind   int
	person int // index into the problem's people
}

type readingProblem struct {
	people    []int // person ids
	city      []int // per person
	colour    []int
	writesTo  []int // per person: index of another person
	facts     []personFact
	start     int
	steps     int
	askColour bool
}

func newReading(r *rng, level int) problem {
	return readingOf(r, [levels]int{6, 9, 12, 15, 18}[level-1], [levels]int{3, 6, 12, 25, 50}[level-1])
}

// readingOf builds a text about size people and a walk of steps letters.
func readingOf(r *rng, size, steps int) problem {
	p := &readingProblem{
		people: r.perm(peopleCount)[:size],
		city:   r.perm(cityCount)[:size],
		steps:  steps,
	}
	for i := range size {
		p.colour = append(p.colour, r.intn(colourCount))
		other := r.intn(size - 1)
		if other >= i {
			other++ // nobody writes to themselves
		}
		p.writesTo = append(p.writesTo, other)
		for kind := range factKinds {
			p.facts = append(p.facts, personFact{kind: kind, person: i})
		}
	}
	shuffle(r, p.facts)
	p.start = r.intn(size)
	p.askColour = r.intn(2) == 1
	return p
}

// reached is the person the walk ends on.
func (p *readingProblem) reached() int {
	at := p.start
	for range p.steps {
		at = p.writesTo[at]
	}
	return at
}

func (p *readingProblem) text(l *language) string {
	t := l.reading
	name := func(i int) string { return l.people[p.people[i]] }
	var lines []string
	for _, f := range p.facts {
		switch f.kind {
		case factLives:
			lines = append(lines, t.lives(name(f.person), l.cities[p.city[f.person]]))
		case factLikes:
			lines = append(lines, t.likes(name(f.person), l.colours[p.colour[f.person]]))
		case factWrites:
			lines = append(lines, t.writes(name(f.person), name(p.writesTo[f.person])))
		}
	}
	lines = append(lines, "", t.walk(name(p.start), p.steps))
	if p.askColour {
		lines = append(lines, t.askColour)
	} else {
		lines = append(lines, t.askCity)
	}
	return strings.Join(lines, "\n")
}

func (p *readingProblem) solution() answer {
	at := p.reached()
	if p.askColour {
		return answer{hint: hintColour, choice: p.colour[at]}
	}
	return answer{hint: hintCity, choice: p.city[at]}
}
