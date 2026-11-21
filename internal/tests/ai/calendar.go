package ai

// The calendar family names the weekday of one date and asks for the weekday
// of another date in the same year. Dates run from March to December, so the
// answer never depends on whether the year is a leap year.

var monthDays = [12]int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}

type calendarDate struct{ month, day int }

// dayOfYear counts from the first of January in a year without a leap day.
func (d calendarDate) dayOfYear() int {
	n := d.day
	for m := 1; m < d.month; m++ {
		n += monthDays[m-1]
	}
	return n
}

type calendarProblem struct {
	known   calendarDate
	weekday int // of the known date, Monday is zero
	target  calendarDate
}

func newCalendar(r *rng, level int) problem {
	// The level sets how many month ends lie between the two dates.
	span := [levels][2]int{{0, 0}, {1, 1}, {2, 3}, {4, 6}, {7, 9}}[level-1]
	months := r.between(span[0], span[1])

	early := calendarDate{month: r.between(3, 12-months)}
	late := calendarDate{month: early.month + months}
	if months == 0 {
		// Inside one month the dates are at least eight days apart, so the
		// answer is never read off the same week.
		early.day = r.between(1, monthDays[early.month-1]-8)
		late.day = r.between(early.day+8, monthDays[late.month-1])
	} else {
		early.day = r.between(1, monthDays[early.month-1])
		late.day = r.between(1, monthDays[late.month-1])
	}

	p := &calendarProblem{known: early, target: late, weekday: r.intn(7)}
	if r.intn(2) == 1 { // ask backwards in time as often as forwards
		p.known, p.target = late, early
	}
	return p
}

func (p *calendarProblem) text(l *language) string {
	t := l.calendar
	return t.ask(
		t.date(p.known.month, p.known.day),
		l.weekdays[p.weekday],
		t.date(p.target.month, p.target.day),
	)
}

func (p *calendarProblem) solution() answer {
	days := p.target.dayOfYear() - p.known.dayOfYear()
	return answer{hint: hintWeekday, choice: ((p.weekday+days)%7 + 7) % 7}
}
