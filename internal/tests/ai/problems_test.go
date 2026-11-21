package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNumberWords(t *testing.T) {
	cases := map[int][4]string{ // en, de, es, zh
		0:   {"zero", "null", "cero", "零"},
		7:   {"seven", "sieben", "siete", "七"},
		10:  {"ten", "zehn", "diez", "十"},
		12:  {"twelve", "zwölf", "doce", "十二"},
		16:  {"sixteen", "sechzehn", "dieciséis", "十六"},
		17:  {"seventeen", "siebzehn", "diecisiete", "十七"},
		20:  {"twenty", "zwanzig", "veinte", "二十"},
		22:  {"twenty-two", "zweiundzwanzig", "veintidós", "二十二"},
		26:  {"twenty-six", "sechsundzwanzig", "veintiséis", "二十六"},
		30:  {"thirty", "dreißig", "treinta", "三十"},
		47:  {"forty-seven", "siebenundvierzig", "cuarenta y siete", "四十七"},
		60:  {"sixty", "sechzig", "sesenta", "六十"},
		70:  {"seventy", "siebzig", "setenta", "七十"},
		99:  {"ninety-nine", "neunundneunzig", "noventa y nueve", "九十九"},
		100: {"one hundred", "einhundert", "cien", "一百"},
		105: {"one hundred five", "einhundertfünf", "ciento cinco", "一百零五"},
		110: {"one hundred ten", "einhundertzehn", "ciento diez", "一百一十"},
		116: {"one hundred sixteen", "einhundertsechzehn", "ciento dieciséis", "一百一十六"},
		200: {"two hundred", "zweihundert", "doscientos", "二百"},
		347: {"three hundred forty-seven", "dreihundertsiebenundvierzig", "trescientos cuarenta y siete", "三百四十七"},
		500: {"five hundred", "fünfhundert", "quinientos", "五百"},
		708: {"seven hundred eight", "siebenhundertacht", "setecientos ocho", "七百零八"},
		920: {"nine hundred twenty", "neunhundertzwanzig", "novecientos veinte", "九百二十"},
		999: {"nine hundred ninety-nine", "neunhundertneunundneunzig", "novecientos noventa y nueve", "九百九十九"},
	}
	for n, want := range cases {
		for i, l := range languages {
			if got := l.number(n); got != want[i] {
				t.Errorf("%s number(%d) = %q, want %q", l.code, n, got, want[i])
			}
		}
	}
	// Two numbers never share a spelling.
	for _, l := range languages {
		seen := make(map[string]int)
		for n := range 1000 {
			word := l.number(n)
			if other, dup := seen[word]; dup {
				t.Errorf("%s spells %d and %d the same: %q", l.code, other, n, word)
			}
			seen[word] = n
		}
	}
}

// problemSetHash pins the protocol's problem set: every prompt in every
// language and every expected answer. If this changes, reports made before
// and after are no longer about the same problems, and the protocol needs a
// new version rather than a new hash.
const problemSetHash = "2b36a39f41e04ebe031c275a87f47cb561208a56869e9fad4df1d12a6f43b30f"

func TestProblemSetIsPinned(t *testing.T) {
	h := sha256.New()
	for _, f := range families {
		problems := f.problems(false)
		if len(problems) != levels*perLevel {
			t.Fatalf("%s has %d problems, want %d", f.name, len(problems), levels*perLevel)
		}
		for i, p := range problems {
			fmt.Fprintf(h, "%s/%d/%+v\n", f.name, i, p.solution())
			for _, l := range languages {
				text := prompt(p, l)
				if strings.Contains(text, "%!") || strings.TrimSpace(text) == "" {
					t.Fatalf("%s #%d in %s is malformed: %q", f.name, i, l.code, text)
				}
				fmt.Fprintf(h, "%s\n%s\n", l.code, text)
			}
		}
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != problemSetHash {
		t.Errorf("the problem set changed: hash %s, pinned %s", got, problemSetHash)
	}
}

func TestQuickProblemsAreASubsetOfTheFullSet(t *testing.T) {
	for _, f := range families {
		full, quick := f.problems(false), f.problems(true)
		if len(quick) != levels*quickPerLevel {
			t.Fatalf("%s quick set has %d problems", f.name, len(quick))
		}
		for i, p := range quick {
			level, slot := i/quickPerLevel, i%quickPerLevel
			if got, want := prompt(p, &english), prompt(full[level*perLevel+slot], &english); got != want {
				t.Errorf("%s quick #%d is not full #%d", f.name, i, level*perLevel+slot)
			}
		}
	}
}

func TestProblemsDifferAndGetHarder(t *testing.T) {
	for _, f := range families {
		problems := f.problems(false)
		seen := make(map[string]bool)
		for _, p := range problems {
			seen[prompt(p, &english)] = true
		}
		if len(seen) != len(problems) {
			t.Errorf("%s repeats a problem: %d distinct of %d", f.name, len(seen), len(problems))
		}
		// A higher level is a longer problem in every family but calendar,
		// whose levels move the dates apart instead.
		if f.name == "calendar" {
			continue
		}
		first, last := len(prompt(problems[0], &english)), len(prompt(problems[len(problems)-1], &english))
		if last <= first {
			t.Errorf("%s: the last problem (%d bytes) is not longer than the first (%d)", f.name, last, first)
		}
	}
}

// The checks below read the English text of every problem with a second,
// separately written interpreter and compare its result with the answer the
// generator recorded. They catch a sentence that says something other than
// what the generator computed. The other languages are rendered from the
// same structure through the same switch, sentence for sentence.

func parseEnglishNumber(t *testing.T, words string) int {
	t.Helper()
	value := map[string]int{}
	for n, w := range enOnes {
		value[w] = n
	}
	for n, w := range enTens {
		if w != "" {
			value[w] = n * 10
		}
	}
	total := 0
	for _, w := range strings.FieldsFunc(words, func(r rune) bool { return r == ' ' || r == '-' }) {
		if w == "hundred" {
			total *= 100
			continue
		}
		v, ok := value[w]
		if !ok {
			t.Fatalf("unknown number word %q in %q", w, words)
		}
		total += v
	}
	return total
}

func TestArithmeticTextMatchesItsAnswer(t *testing.T) {
	side := map[string]int{"north": 0, "south": 1}
	patterns := []struct {
		re    *regexp.Regexp
		apply func(m []string, stock *[2]int) (int, bool)
	}{
		{regexp.MustCompile(`^The north warehouse holds (.+) crates and the south warehouse holds (.+) crates\.$`),
			func(m []string, s *[2]int) (int, bool) {
				s[0], s[1] = parseEnglishNumber(t, m[1]), parseEnglishNumber(t, m[2])
				return 0, false
			}},
		{regexp.MustCompile(`^The (north|south) warehouse receives a delivery of (.+) crates\.$`),
			func(m []string, s *[2]int) (int, bool) { s[side[m[1]]] += parseEnglishNumber(t, m[2]); return 0, false }},
		{regexp.MustCompile(`^The (north|south) warehouse ships (.+) crates to customers\.$`),
			func(m []string, s *[2]int) (int, bool) { s[side[m[1]]] -= parseEnglishNumber(t, m[2]); return 0, false }},
		{regexp.MustCompile(`^From the (north|south) warehouse, (.+) crates are moved to the (north|south) warehouse\.$`),
			func(m []string, s *[2]int) (int, bool) {
				if m[1] == m[3] {
					t.Fatalf("a move from a warehouse to itself: %q", m[0])
				}
				n := parseEnglishNumber(t, m[2])
				s[side[m[1]]] -= n
				s[side[m[3]]] += n
				return 0, false
			}},
		{regexp.MustCompile(`^The stock of the (north|south) warehouse doubles\.$`),
			func(m []string, s *[2]int) (int, bool) { s[side[m[1]]] *= 2; return 0, false }},
		{regexp.MustCompile(`^Half of the crates in the (north|south) warehouse are sold\.$`),
			func(m []string, s *[2]int) (int, bool) {
				if s[side[m[1]]]%2 != 0 {
					t.Fatalf("half of an odd stock: %q", m[0])
				}
				s[side[m[1]]] /= 2
				return 0, false
			}},
		{regexp.MustCompile(`^How many crates are in the (north|south) warehouse at the end\?$`),
			func(m []string, s *[2]int) (int, bool) { return s[side[m[1]]], true }},
		{regexp.MustCompile(`^How many crates are in the two warehouses together at the end\?$`),
			func(m []string, s *[2]int) (int, bool) { return s[0] + s[1], true }},
		{regexp.MustCompile(`^At the end, by how many crates do the stocks of the two warehouses differ\?$`),
			func(m []string, s *[2]int) (int, bool) { return max(s[0]-s[1], s[1]-s[0]), true }},
	}
	for i, p := range familyNamed(t, "arithmetic").problems(false) {
		var stock [2]int
		result, answered := 0, false
		for _, line := range strings.Split(p.text(&english), "\n") {
			matched := false
			for _, pattern := range patterns {
				if m := pattern.re.FindStringSubmatch(line); m != nil {
					result, answered = pattern.apply(m, &stock)
					matched = true
					break
				}
			}
			if !matched {
				t.Fatalf("#%d: no rule reads %q", i, line)
			}
			if stock[0] < 0 || stock[1] < 0 {
				t.Fatalf("#%d: a stock went negative at %q", i, line)
			}
		}
		if want := p.solution().number; !answered || result != want {
			t.Errorf("#%d: the text works out to %d, the recorded answer is %d", i, result, want)
		}
	}
}

func TestProcedureTextMatchesItsAnswer(t *testing.T) {
	intro := regexp.MustCompile(`^Here is a list of numbers: (.+)\. Apply the following steps in order\.$`)
	step := regexp.MustCompile(`^\d+\. (.+)$`)
	withNumber := regexp.MustCompile(`^(Remove every number that is divisible by|Add|Remove every number that is greater than|Multiply every number by) ([a-z -]+?)( to every number)?\.$`)
	for i, p := range familyNamed(t, "procedure").problems(false) {
		lines := strings.Split(p.text(&english), "\n")
		m := intro.FindStringSubmatch(lines[0])
		if m == nil {
			t.Fatalf("#%d: unreadable first line %q", i, lines[0])
		}
		var list []int
		for _, field := range strings.Split(m[1], ", ") {
			n, err := strconv.Atoi(field)
			if err != nil {
				t.Fatal(err)
			}
			list = append(list, n)
		}
		keep := func(ok func(int) bool) {
			var out []int
			for _, v := range list {
				if ok(v) {
					out = append(out, v)
				}
			}
			list = out
		}
		for _, line := range lines[1 : len(lines)-1] {
			s := step.FindStringSubmatch(line)
			if s == nil {
				t.Fatalf("#%d: unreadable step %q", i, line)
			}
			before := slices.Clone(list)
			switch sentence := s[1]; sentence {
			case "Reverse the order of the list.":
				slices.Reverse(list)
			case "Swap the first number and the last number.":
				list[0], list[len(list)-1] = list[len(list)-1], list[0]
			case "Sort the list from largest to smallest.":
				slices.Sort(list)
				slices.Reverse(list)
			case "Sort the list from smallest to largest.":
				slices.Sort(list)
			case "Remove the largest number.":
				top := slices.Max(list)
				keep(func(v int) bool { return v != top })
			case "Remove the smallest number.":
				bottom := slices.Min(list)
				keep(func(v int) bool { return v != bottom })
			default:
				w := withNumber.FindStringSubmatch(sentence)
				if w == nil {
					t.Fatalf("#%d: no rule reads %q", i, sentence)
				}
				n := parseEnglishNumber(t, w[2])
				switch w[1] {
				case "Remove every number that is divisible by":
					keep(func(v int) bool { return v%n != 0 })
				case "Remove every number that is greater than":
					keep(func(v int) bool { return v <= n })
				case "Add":
					for j := range list {
						list[j] += n
					}
				case "Multiply every number by":
					for j := range list {
						list[j] *= n
					}
				}
			}
			if slices.Equal(before, list) {
				t.Errorf("#%d: step %q changes nothing", i, line)
			}
			if len(list) < minList {
				t.Fatalf("#%d: only %d numbers left after %q", i, len(list), line)
			}
		}
		var got int
		switch question := lines[len(lines)-1]; question {
		case "Which number is first in the list now?":
			got = list[0]
		case "Which number is last in the list now?":
			got = list[len(list)-1]
		case "What is the sum of all numbers in the list now?":
			for _, v := range list {
				got += v
			}
		case "How many numbers are in the list now?":
			got = len(list)
		default:
			t.Fatalf("#%d: unreadable question %q", i, question)
		}
		if want := p.solution().number; got != want {
			t.Errorf("#%d: the text works out to %d, the recorded answer is %d", i, got, want)
		}
	}
}

func TestOrderingTextMatchesItsAnswer(t *testing.T) {
	fact := regexp.MustCompile(`^(\w+) is (older|younger) than (\w+)\.$`)
	ask := regexp.MustCompile(`Who stands in position (\d+)\?$`)
	for i, p := range familyNamed(t, "ordering").problems(false) {
		lines := strings.Split(p.text(&english), "\n")
		olderThan := map[string]string{} // person -> the next younger person
		hasOlder := map[string]bool{}
		for _, line := range lines[1 : len(lines)-1] {
			m := fact.FindStringSubmatch(line)
			if m == nil {
				t.Fatalf("#%d: unreadable fact %q", i, line)
			}
			older, younger := m[1], m[3]
			if m[2] == "younger" {
				older, younger = younger, older
			}
			olderThan[older] = younger
			hasOlder[younger] = true
		}
		// The oldest is the one nobody is older than; walk down from there.
		var line []string
		for person := range olderThan {
			if !hasOlder[person] {
				line = append(line, person)
			}
		}
		if len(line) != 1 {
			t.Fatalf("#%d: the facts do not fix one oldest person: %v", i, line)
		}
		for {
			next, ok := olderThan[line[len(line)-1]]
			if !ok {
				break
			}
			line = append(line, next)
		}
		if len(line) != len(olderThan)+1 {
			t.Fatalf("#%d: the facts do not form one line", i)
		}
		position, _ := strconv.Atoi(ask.FindStringSubmatch(lines[len(lines)-1])[1])
		got := line[len(line)-position] // position counts from the youngest
		if want := english.people[p.solution().choice]; got != want {
			t.Errorf("#%d: the text works out to %s, the recorded answer is %s", i, got, want)
		}
	}
}

func TestReadingTextMatchesItsAnswer(t *testing.T) {
	lives := regexp.MustCompile(`^(\w+) lives in (\w+)\.$`)
	likes := regexp.MustCompile(`^(\w+) likes the colour (\w+) best\.$`)
	writes := regexp.MustCompile(`^(\w+) writes letters to (\w+)\.$`)
	walk := regexp.MustCompile(`^Start with (\w+)\. .* Number of steps: (\d+)\.$`)
	for i, p := range familyNamed(t, "reading").problems(false) {
		city, colour, to := map[string]string{}, map[string]string{}, map[string]string{}
		lines := strings.Split(p.text(&english), "\n")
		at, steps := "", 0
		for _, line := range lines[:len(lines)-1] {
			switch {
			case line == "":
			case lives.MatchString(line):
				m := lives.FindStringSubmatch(line)
				city[m[1]] = m[2]
			case likes.MatchString(line):
				m := likes.FindStringSubmatch(line)
				colour[m[1]] = m[2]
			case writes.MatchString(line):
				m := writes.FindStringSubmatch(line)
				if m[1] == m[2] {
					t.Fatalf("#%d: %s writes to themselves", i, m[1])
				}
				to[m[1]] = m[2]
			case walk.MatchString(line):
				m := walk.FindStringSubmatch(line)
				at = m[1]
				steps, _ = strconv.Atoi(m[2])
			default:
				t.Fatalf("#%d: no rule reads %q", i, line)
			}
		}
		if len(city) != len(to) || len(colour) != len(to) || steps == 0 {
			t.Fatalf("#%d: incomplete facts", i)
		}
		for range steps {
			at = to[at]
		}
		got, want := "", ""
		switch lines[len(lines)-1] {
		case english.reading.askCity:
			got, want = city[at], english.cities[p.solution().choice]
		case english.reading.askColour:
			got, want = colour[at], english.colours[p.solution().choice]
		}
		if got == "" || got != want {
			t.Errorf("#%d: the text works out to %q, the recorded answer is %q", i, got, want)
		}
	}
}

func TestCalendarAnswersMatchARealCalendar(t *testing.T) {
	text := regexp.MustCompile(`^In a certain year, (\w+) (\d+) is a (\w+)\. Which day of the week is (\w+) (\d+) in the same year\?$`)
	month := func(name string) time.Month { return time.Month(slices.Index(enMonths[:], name) + 1) }
	for i, p := range familyNamed(t, "calendar").problems(false) {
		m := text.FindStringSubmatch(p.text(&english))
		if m == nil {
			t.Fatalf("#%d: unreadable problem %q", i, p.text(&english))
		}
		knownDay, _ := strconv.Atoi(m[2])
		targetDay, _ := strconv.Atoi(m[5])
		// 2023 has no leap day; any such year gives the same distances.
		known := time.Date(2023, month(m[1]), knownDay, 0, 0, 0, 0, time.UTC)
		target := time.Date(2023, month(m[4]), targetDay, 0, 0, 0, 0, time.UTC)
		if known.Month() < time.March || target.Month() < time.March {
			t.Errorf("#%d: a date before March makes the answer depend on leap years", i)
		}
		// Go counts weekdays from Sunday, the suite from Monday.
		shift := (int(target.Weekday()) - int(known.Weekday()) + 7) % 7
		want := (slices.Index(english.weekdays[:], m[3]) + shift) % 7
		if got := p.solution().choice; got != want {
			t.Errorf("#%d: recorded %s, a calendar says %s", i, english.weekdays[got], english.weekdays[want])
		}
	}
}

// Stated quantities must read the same before a noun in every language.
func TestArithmeticOnlyStatesNounableNumbers(t *testing.T) {
	for i, p := range familyNamed(t, "arithmetic").problems(false) {
		a := p.(*arithmeticProblem)
		numbers := []int{a.start[0], a.start[1]}
		for _, e := range a.events {
			if e.kind == stockReceive || e.kind == stockShip || e.kind == stockMove {
				numbers = append(numbers, e.n)
			}
		}
		for _, n := range numbers {
			if !nounable(n) {
				t.Errorf("#%d states %d, which changes form before a noun in some language", i, n)
			}
		}
	}
}

func familyNamed(t *testing.T, name string) family {
	t.Helper()
	for _, f := range families {
		if f.name == name {
			return f
		}
	}
	t.Fatalf("no family %q", name)
	return family{}
}
