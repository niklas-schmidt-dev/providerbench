package ai

import (
	"fmt"
	"strconv"
)

var english = language{
	code:   "en",
	name:   "English",
	number: englishNumber,
	marker: "Answer",
	instruction: "Solve the problem step by step, then end with one final line in exactly this form:\n" +
		"Answer: <your answer>",
	hints: [hintCount]string{
		hintNumber:  "Give the answer as a number written in digits.",
		hintPerson:  "Give only the name.",
		hintCity:    "Give only the name of the city.",
		hintColour:  "Give only the colour.",
		hintWeekday: "Give only the day of the week.",
	},
	people: [peopleCount]string{
		"Anna", "Boris", "Clara", "David", "Elena", "Felix", "Greta", "Hugo", "Irene", "Jonas",
		"Karin", "Leo", "Marta", "Nora", "Oskar", "Paula", "Robert", "Sofia", "Tomas", "Vera",
	},
	cities: [cityCount]string{
		"Paris", "Berlin", "Rome", "Vienna", "Prague", "Lisbon", "Athens", "Warsaw", "Dublin",
		"Oslo", "Madrid", "Helsinki", "Stockholm", "Budapest", "Brussels", "Copenhagen", "Amsterdam", "Zurich",
	},
	colours: [colourCount]string{
		"red", "blue", "green", "yellow", "black", "white", "orange", "purple", "brown", "grey", "pink",
	},
	colourAliases: [colourCount][]string{7: {"violet"}, 9: {"gray"}},
	weekdays:      [7]string{"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"},

	arithmetic: arithmeticText{
		start: func(north, south string) string {
			return fmt.Sprintf("The north warehouse holds %s crates and the south warehouse holds %s crates.", north, south)
		},
		receive: func(w int, n string) string {
			return fmt.Sprintf("The %s warehouse receives a delivery of %s crates.", enSide[w], n)
		},
		ship: func(w int, n string) string {
			return fmt.Sprintf("The %s warehouse ships %s crates to customers.", enSide[w], n)
		},
		move: func(from int, n string) string {
			return fmt.Sprintf("From the %s warehouse, %s crates are moved to the %s warehouse.", enSide[from], n, enSide[1-from])
		},
		double: func(w int) string {
			return fmt.Sprintf("The stock of the %s warehouse doubles.", enSide[w])
		},
		halve: func(w int) string {
			return fmt.Sprintf("Half of the crates in the %s warehouse are sold.", enSide[w])
		},
		askOne: func(w int) string {
			return fmt.Sprintf("How many crates are in the %s warehouse at the end?", enSide[w])
		},
		askTotal: "How many crates are in the two warehouses together at the end?",
		askDiff:  "At the end, by how many crates do the stocks of the two warehouses differ?",
	},

	ordering: orderingText{
		intro:   "Several people are compared by age. No two of them are the same age.",
		older:   func(a, b string) string { return a + " is older than " + b + "." },
		younger: func(a, b string) string { return a + " is younger than " + b + "." },
		ask: func(position int) string {
			return fmt.Sprintf("Everyone lines up from youngest to oldest, so the youngest stands in position 1. Who stands in position %d?", position)
		},
	},

	reading: readingText{
		lives:  func(person, city string) string { return person + " lives in " + city + "." },
		likes:  func(person, colour string) string { return person + " likes the colour " + colour + " best." },
		writes: func(person, to string) string { return person + " writes letters to " + to + "." },
		walk: func(start string, steps int) string {
			return fmt.Sprintf("Start with %s. One step means going from the current person to the person they write letters to. Number of steps: %d.", start, steps)
		},
		askCity:   "In which city does the person you arrive at live?",
		askColour: "Which colour does the person you arrive at like best?",
	},

	procedure: procedureText{
		intro: func(list string) string {
			return "Here is a list of numbers: " + list + ". Apply the following steps in order."
		},
		separator:       ", ",
		removeDivisible: func(n string) string { return "Remove every number that is divisible by " + n + "." },
		reverse:         "Reverse the order of the list.",
		add:             func(n string) string { return "Add " + n + " to every number." },
		swapEnds:        "Swap the first number and the last number.",
		sortDescending:  "Sort the list from largest to smallest.",
		sortAscending:   "Sort the list from smallest to largest.",
		removeLargest:   "Remove the largest number.",
		removeSmallest:  "Remove the smallest number.",
		removeGreater:   func(n string) string { return "Remove every number that is greater than " + n + "." },
		multiply:        func(n string) string { return "Multiply every number by " + n + "." },
		askFirst:        "Which number is first in the list now?",
		askLast:         "Which number is last in the list now?",
		askSum:          "What is the sum of all numbers in the list now?",
		askCount:        "How many numbers are in the list now?",
	},

	calendar: calendarText{
		date: func(month, day int) string { return enMonths[month-1] + " " + strconv.Itoa(day) },
		ask: func(known, weekday, target string) string {
			return fmt.Sprintf("In a certain year, %s is a %s. Which day of the week is %s in the same year?", known, weekday, target)
		},
	},
}

var enSide = [2]string{"north", "south"}

var enMonths = [12]string{
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
}

var (
	enOnes = [20]string{
		"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
		"eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
	}
	enTens = [10]string{"", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"}
)

func englishNumber(n int) string {
	checkNumber(n)
	if n >= 100 {
		words := enOnes[n/100] + " hundred"
		if n%100 != 0 {
			words += " " + englishNumber(n%100)
		}
		return words
	}
	if n < 20 {
		return enOnes[n]
	}
	if n%10 == 0 {
		return enTens[n/10]
	}
	return enTens[n/10] + "-" + enOnes[n%10]
}

// checkNumber guards the range every number speller covers. Leaving it would
// publish a wrong word, so it is a programming error, not a result.
func checkNumber(n int) {
	if n < 0 || n > 999 {
		panic(fmt.Sprintf("ai: number %d is outside 0..999", n))
	}
}
