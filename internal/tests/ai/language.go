package ai

// language holds everything that differs between the languages a problem is
// posed in: number words, vocabulary and the sentences of every task family.
// The generators never contain language; adding one is a single file that
// fills this struct and joins languages below. The list is part of the
// protocol: it decides which metrics a report carries.
type language struct {
	code string // metric suffix, e.g. "de"
	name string // English name, for summaries

	// number spells a cardinal from 0 to 999 as it stands on its own or
	// before a plural noun. The generators only pass numbers that read the
	// same in both positions in every language (see nounable).
	number func(n int) string

	marker      string // the word that opens the final answer line
	instruction string // asks for that line
	hints       [hintCount]string

	people   [peopleCount]string
	cities   [cityCount]string
	colours  [colourCount]string
	weekdays [7]string // Monday first
	// aliases are further spellings a correct answer may use.
	colourAliases  [colourCount][]string
	weekdayAliases [7][]string

	arithmetic arithmeticText
	ordering   orderingText
	reading    readingText
	procedure  procedureText
	calendar   calendarText
}

const (
	peopleCount = 20
	cityCount   = 18
	colourCount = 11
)

// hintKind says what form the final answer takes.
type hintKind int

const (
	hintNumber hintKind = iota
	hintPerson
	hintCity
	hintColour
	hintWeekday
	hintCount
)

// languages is the protocol's language set in report order. English is first
// because every other language is read against it.
var languages = []*language{&english, &german, &spanish, &chinese}

// nounable reports whether n reads the same on its own and before a plural
// noun in every language of the suite. Numbers ending in one do not (German
// "eins"/"ein", Spanish "uno"/"un"), and a bare two takes another word before
// a Chinese measure word, so problems never state those.
func nounable(n int) bool {
	return n >= 12 && n <= 999 && n%10 != 1
}

// standalone reports whether n can be named on its own, as in "add five".
func standalone(n int) bool {
	return n >= 2 && n <= 999 && n%10 != 1
}

// The text types below are the sentences of one task family. Functions take
// words that are already in the language; w is a warehouse, 0 north, 1 south.

type arithmeticText struct {
	start    func(north, south string) string
	receive  func(w int, n string) string
	ship     func(w int, n string) string
	move     func(from int, n string) string // to the other warehouse
	double   func(w int) string
	halve    func(w int) string
	askOne   func(w int) string
	askTotal string
	askDiff  string
}

type orderingText struct {
	intro   string
	older   func(a, b string) string // a is older than b
	younger func(a, b string) string // a is younger than b
	ask     func(position int) string
}

type readingText struct {
	lives     func(person, city string) string
	likes     func(person, colour string) string
	writes    func(person, to string) string
	walk      func(start string, steps int) string
	askCity   string
	askColour string
}

type procedureText struct {
	intro           func(list string) string
	separator       string // between the numbers of the list
	removeDivisible func(n string) string
	reverse         string
	add             func(n string) string
	swapEnds        string
	sortDescending  string
	sortAscending   string
	removeLargest   string
	removeSmallest  string
	removeGreater   func(n string) string
	multiply        func(n string) string
	askFirst        string
	askLast         string
	askSum          string
	askCount        string
}

type calendarText struct {
	date func(month, day int) string // month 1..12
	ask  func(known, weekday, target string) string
}
