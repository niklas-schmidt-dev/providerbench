package ai

import "strings"

// The arithmetic family keeps the stock of two warehouses through a list of
// events. Every quantity is spelled out in words, so reading the numbers is
// part of the task and differs by language.

const (
	stockReceive = iota
	stockShip
	stockMove
	stockDouble
	stockHalve
	stockKinds
)

const (
	askNorth = iota
	askSouth
	askTotal
	askDifference
	askKinds
)

type stockEvent struct {
	kind int
	w    int // warehouse acted on; the source of a move
	n    int
}

type arithmeticProblem struct {
	start  [2]int
	events []stockEvent
	ask    int
	want   int
}

func newArithmetic(r *rng, level int) problem {
	return arithmeticOf(r, [levels]int{10, 20, 40, 80, 160}[level-1], [levels]int{99, 999, 999, 999, 999}[level-1])
}

// arithmeticOf builds a problem of steps events with quantities up to limit.
func arithmeticOf(r *rng, steps, limit int) problem {
	p := &arithmeticProblem{}
	for w := range p.start {
		p.start[w], _ = r.pick(20, limit, nounable)
	}
	stock := p.start
	for len(p.events) < steps {
		e := stockEvent{kind: r.intn(stockKinds), w: r.intn(2)}
		switch e.kind {
		case stockReceive:
			e.n, _ = r.pick(12, limit, nounable)
			stock[e.w] += e.n
		case stockShip, stockMove:
			n, ok := r.pick(12, min(stock[e.w], limit), nounable)
			if !ok {
				continue
			}
			e.n = n
			stock[e.w] -= n
			if e.kind == stockMove {
				stock[1-e.w] += n
			}
		case stockDouble:
			// Bounded so that stocks stay in the low thousands.
			if stock[e.w] == 0 || stock[e.w] > 2000 {
				continue
			}
			stock[e.w] *= 2
		case stockHalve:
			if stock[e.w] == 0 || stock[e.w]%2 != 0 {
				continue
			}
			stock[e.w] /= 2
		}
		p.events = append(p.events, e)
	}

	p.ask = r.intn(askKinds)
	switch p.ask {
	case askNorth, askSouth:
		p.want = stock[p.ask]
	case askTotal:
		p.want = stock[0] + stock[1]
	case askDifference:
		p.want = max(stock[0], stock[1]) - min(stock[0], stock[1])
	}
	return p
}

func (p *arithmeticProblem) text(l *language) string {
	t := l.arithmetic
	lines := []string{t.start(l.number(p.start[0]), l.number(p.start[1]))}
	for _, e := range p.events {
		switch e.kind {
		case stockReceive:
			lines = append(lines, t.receive(e.w, l.number(e.n)))
		case stockShip:
			lines = append(lines, t.ship(e.w, l.number(e.n)))
		case stockMove:
			lines = append(lines, t.move(e.w, l.number(e.n)))
		case stockDouble:
			lines = append(lines, t.double(e.w))
		case stockHalve:
			lines = append(lines, t.halve(e.w))
		}
	}
	switch p.ask {
	case askNorth, askSouth:
		lines = append(lines, t.askOne(p.ask))
	case askTotal:
		lines = append(lines, t.askTotal)
	case askDifference:
		lines = append(lines, t.askDiff)
	}
	return strings.Join(lines, "\n")
}

func (p *arithmeticProblem) solution() answer {
	return answer{hint: hintNumber, number: p.want}
}
