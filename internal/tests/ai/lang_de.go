package ai

import (
	"fmt"
	"strconv"
)

var german = language{
	code:   "de",
	name:   "German",
	number: germanNumber,
	marker: "Antwort",
	instruction: "Löse die Aufgabe Schritt für Schritt und beende deine Antwort mit einer letzten Zeile in genau dieser Form:\n" +
		"Antwort: <deine Antwort>",
	hints: [hintCount]string{
		hintNumber:  "Gib die Antwort als Zahl in Ziffern an.",
		hintPerson:  "Nenne nur den Namen.",
		hintCity:    "Nenne nur den Namen der Stadt.",
		hintColour:  "Nenne nur die Farbe.",
		hintWeekday: "Nenne nur den Wochentag.",
	},
	people: english.people,
	cities: [cityCount]string{
		"Paris", "Berlin", "Rom", "Wien", "Prag", "Lissabon", "Athen", "Warschau", "Dublin",
		"Oslo", "Madrid", "Helsinki", "Stockholm", "Budapest", "Brüssel", "Kopenhagen", "Amsterdam", "Zürich",
	},
	colours: [colourCount]string{
		"Rot", "Blau", "Grün", "Gelb", "Schwarz", "Weiß", "Orange", "Lila", "Braun", "Grau", "Rosa",
	},
	colourAliases:  [colourCount][]string{2: {"Gruen"}, 7: {"Violett"}, 10: {"Pink"}},
	weekdays:       [7]string{"Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"},
	weekdayAliases: [7][]string{5: {"Sonnabend"}},

	arithmetic: arithmeticText{
		start: func(north, south string) string {
			return fmt.Sprintf("Im Nordlager liegen %s Kisten und im Südlager liegen %s Kisten.", north, south)
		},
		receive: func(w int, n string) string {
			return fmt.Sprintf("Das %s erhält eine Lieferung von %s Kisten.", deLager[w], n)
		},
		ship: func(w int, n string) string {
			return fmt.Sprintf("Das %s verschickt %s Kisten an Kunden.", deLager[w], n)
		},
		move: func(from int, n string) string {
			return fmt.Sprintf("Vom %s werden %s Kisten ins %s gebracht.", deLager[from], n, deLager[1-from])
		},
		double: func(w int) string {
			return fmt.Sprintf("Der Bestand des %ss verdoppelt sich.", deLager[w])
		},
		halve: func(w int) string {
			return fmt.Sprintf("Die Hälfte der Kisten im %s wird verkauft.", deLager[w])
		},
		askOne: func(w int) string {
			return fmt.Sprintf("Wie viele Kisten liegen am Ende im %s?", deLager[w])
		},
		askTotal: "Wie viele Kisten liegen am Ende in beiden Lagern zusammen?",
		askDiff:  "Um wie viele Kisten unterscheiden sich am Ende die Bestände der beiden Lager?",
	},

	ordering: orderingText{
		intro:   "Mehrere Personen werden nach ihrem Alter verglichen. Keine zwei von ihnen sind gleich alt.",
		older:   func(a, b string) string { return a + " ist älter als " + b + "." },
		younger: func(a, b string) string { return a + " ist jünger als " + b + "." },
		ask: func(position int) string {
			return fmt.Sprintf("Alle stellen sich in einer Reihe auf, von der jüngsten bis zur ältesten Person; die jüngste Person steht also an Position 1. Wer steht an Position %d?", position)
		},
	},

	reading: readingText{
		lives:  func(person, city string) string { return person + " wohnt in " + city + "." },
		likes:  func(person, colour string) string { return person + " mag die Farbe " + colour + " am liebsten." },
		writes: func(person, to string) string { return person + " schreibt Briefe an " + to + "." },
		walk: func(start string, steps int) string {
			return fmt.Sprintf("Beginne bei %s. Ein Schritt bedeutet, von der aktuellen Person zu der Person zu gehen, an die sie Briefe schreibt. Anzahl der Schritte: %d.", start, steps)
		},
		askCity:   "In welcher Stadt wohnt die Person, bei der du ankommst?",
		askColour: "Welche Farbe mag die Person, bei der du ankommst, am liebsten?",
	},

	procedure: procedureText{
		intro: func(list string) string {
			return "Hier ist eine Liste von Zahlen: " + list + ". Führe die folgenden Schritte der Reihe nach aus."
		},
		separator:       ", ",
		removeDivisible: func(n string) string { return "Entferne jede Zahl, die durch " + n + " teilbar ist." },
		reverse:         "Kehre die Reihenfolge der Liste um.",
		add:             func(n string) string { return "Addiere " + n + " zu jeder Zahl." },
		swapEnds:        "Vertausche die erste Zahl mit der letzten Zahl.",
		sortDescending:  "Sortiere die Liste von der größten zur kleinsten Zahl.",
		sortAscending:   "Sortiere die Liste von der kleinsten zur größten Zahl.",
		removeLargest:   "Entferne die größte Zahl.",
		removeSmallest:  "Entferne die kleinste Zahl.",
		removeGreater:   func(n string) string { return "Entferne jede Zahl, die größer als " + n + " ist." },
		multiply:        func(n string) string { return "Multipliziere jede Zahl mit " + n + "." },
		askFirst:        "Welche Zahl steht jetzt an erster Stelle der Liste?",
		askLast:         "Welche Zahl steht jetzt an letzter Stelle der Liste?",
		askSum:          "Wie groß ist jetzt die Summe aller Zahlen der Liste?",
		askCount:        "Wie viele Zahlen enthält die Liste jetzt?",
	},

	calendar: calendarText{
		date: func(month, day int) string { return strconv.Itoa(day) + ". " + deMonths[month-1] },
		ask: func(known, weekday, target string) string {
			return fmt.Sprintf("In einem bestimmten Jahr ist der %s ein %s. Auf welchen Wochentag fällt der %s desselben Jahres?", known, weekday, target)
		},
	},
}

var deLager = [2]string{"Nordlager", "Südlager"}

var deMonths = [12]string{
	"Januar", "Februar", "März", "April", "Mai", "Juni",
	"Juli", "August", "September", "Oktober", "November", "Dezember",
}

var (
	deOnes = [20]string{
		"null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn",
		"elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn",
	}
	deTens = [10]string{"", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"}
)

// germanNumber writes compounds as one word, units before tens:
// 347 is "dreihundertsiebenundvierzig".
func germanNumber(n int) string {
	checkNumber(n)
	if n >= 100 {
		words := deUnit(n/100) + "hundert"
		if n%100 != 0 {
			words += germanNumber(n % 100)
		}
		return words
	}
	if n < 20 {
		return deOnes[n]
	}
	if n%10 == 0 {
		return deTens[n/10]
	}
	return deUnit(n%10) + "und" + deTens[n/10]
}

// deUnit is a digit inside a compound, where one is "ein", not "eins".
func deUnit(d int) string {
	if d == 1 {
		return "ein"
	}
	return deOnes[d]
}
