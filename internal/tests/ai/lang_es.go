package ai

import (
	"fmt"
	"strconv"
)

var spanish = language{
	code:   "es",
	name:   "Spanish",
	number: spanishNumber,
	marker: "Respuesta",
	instruction: "Resuelve el problema paso a paso y termina con una última línea exactamente con este formato:\n" +
		"Respuesta: <tu respuesta>",
	hints: [hintCount]string{
		hintNumber:  "Da la respuesta como un número escrito en cifras.",
		hintPerson:  "Indica solo el nombre.",
		hintCity:    "Indica solo el nombre de la ciudad.",
		hintColour:  "Indica solo el color.",
		hintWeekday: "Indica solo el día de la semana.",
	},
	people: english.people,
	cities: [cityCount]string{
		"París", "Berlín", "Roma", "Viena", "Praga", "Lisboa", "Atenas", "Varsovia", "Dublín",
		"Oslo", "Madrid", "Helsinki", "Estocolmo", "Budapest", "Bruselas", "Copenhague", "Ámsterdam", "Zúrich",
	},
	colours: [colourCount]string{
		"rojo", "azul", "verde", "amarillo", "negro", "blanco", "naranja", "morado", "marrón", "gris", "rosa",
	},
	colourAliases: [colourCount][]string{6: {"anaranjado"}, 7: {"violeta", "púrpura"}, 8: {"café"}, 10: {"rosado"}},
	weekdays:      [7]string{"lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"},

	// The counted noun is masculine, so the hundreds keep their base form.
	arithmetic: arithmeticText{
		start: func(north, south string) string {
			return fmt.Sprintf("En el almacén norte hay %s paquetes y en el almacén sur hay %s paquetes.", north, south)
		},
		receive: func(w int, n string) string {
			return fmt.Sprintf("El almacén %s recibe una entrega de %s paquetes.", esSide[w], n)
		},
		ship: func(w int, n string) string {
			return fmt.Sprintf("El almacén %s envía %s paquetes a clientes.", esSide[w], n)
		},
		move: func(from int, n string) string {
			return fmt.Sprintf("Del almacén %s se trasladan %s paquetes al almacén %s.", esSide[from], n, esSide[1-from])
		},
		double: func(w int) string {
			return fmt.Sprintf("Las existencias del almacén %s se duplican.", esSide[w])
		},
		halve: func(w int) string {
			return fmt.Sprintf("Se vende la mitad de los paquetes del almacén %s.", esSide[w])
		},
		askOne: func(w int) string {
			return fmt.Sprintf("¿Cuántos paquetes hay al final en el almacén %s?", esSide[w])
		},
		askTotal: "¿Cuántos paquetes hay al final en los dos almacenes juntos?",
		askDiff:  "Al final, ¿en cuántos paquetes se diferencian las existencias de los dos almacenes?",
	},

	ordering: orderingText{
		intro:   "Se compara la edad de varias personas. No hay dos que tengan la misma edad.",
		older:   func(a, b string) string { return a + " es mayor que " + b + "." },
		younger: func(a, b string) string { return a + " es menor que " + b + "." },
		ask: func(position int) string {
			return fmt.Sprintf("Todos se colocan en fila, de la persona más joven a la de más edad, de modo que la más joven ocupa la posición 1. ¿Quién ocupa la posición %d?", position)
		},
	},

	reading: readingText{
		lives:  func(person, city string) string { return person + " vive en " + city + "." },
		likes:  func(person, colour string) string { return "El color favorito de " + person + " es el " + colour + "." },
		writes: func(person, to string) string { return person + " escribe cartas a " + to + "." },
		walk: func(start string, steps int) string {
			return fmt.Sprintf("Empieza por %s. Un paso consiste en pasar de la persona actual a la persona a la que esta le escribe cartas. Número de pasos: %d.", start, steps)
		},
		askCity:   "¿En qué ciudad vive la persona a la que llegas?",
		askColour: "¿Cuál es el color favorito de la persona a la que llegas?",
	},

	procedure: procedureText{
		intro: func(list string) string {
			return "Aquí hay una lista de números: " + list + ". Aplica los siguientes pasos en orden."
		},
		separator:       ", ",
		removeDivisible: func(n string) string { return "Elimina todos los números que sean divisibles por " + n + "." },
		reverse:         "Invierte el orden de la lista.",
		add:             func(n string) string { return "Suma " + n + " a cada número." },
		swapEnds:        "Intercambia el primer número con el último.",
		sortDescending:  "Ordena la lista de mayor a menor.",
		sortAscending:   "Ordena la lista de menor a mayor.",
		removeLargest:   "Elimina el número más grande.",
		removeSmallest:  "Elimina el número más pequeño.",
		removeGreater:   func(n string) string { return "Elimina todos los números que sean mayores que " + n + "." },
		multiply:        func(n string) string { return "Multiplica cada número por " + n + "." },
		askFirst:        "¿Qué número ocupa ahora el primer lugar de la lista?",
		askLast:         "¿Qué número ocupa ahora el último lugar de la lista?",
		askSum:          "¿Cuánto suman ahora todos los números de la lista?",
		askCount:        "¿Cuántos números hay ahora en la lista?",
	},

	calendar: calendarText{
		date: func(month, day int) string { return strconv.Itoa(day) + " de " + esMonths[month-1] },
		ask: func(known, weekday, target string) string {
			return fmt.Sprintf("En cierto año, el %s cae en %s. ¿En qué día de la semana cae el %s del mismo año?", known, weekday, target)
		},
	},
}

var esSide = [2]string{"norte", "sur"}

var esMonths = [12]string{
	"enero", "febrero", "marzo", "abril", "mayo", "junio",
	"julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
}

var (
	// Through 29 a number is one word, with its own spelling and accents.
	esBelow30 = [30]string{
		"cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
		"once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
		"veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
		"veintisiete", "veintiocho", "veintinueve",
	}
	esTens     = [10]string{"", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"}
	esHundreds = [10]string{
		"", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
		"seiscientos", "setecientos", "ochocientos", "novecientos",
	}
)

func spanishNumber(n int) string {
	checkNumber(n)
	if n == 100 {
		return "cien"
	}
	if n > 100 {
		words := esHundreds[n/100]
		if n%100 != 0 {
			words += " " + spanishNumber(n%100)
		}
		return words
	}
	if n < 30 {
		return esBelow30[n]
	}
	if n%10 == 0 {
		return esTens[n/10]
	}
	return esTens[n/10] + " y " + esBelow30[n%10]
}
