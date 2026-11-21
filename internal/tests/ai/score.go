package ai

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Outcome characters, one per problem in a result's outcome string.
const (
	Solved   = '1'
	Wrong    = '0'
	NoAnswer = '-' // the reply had no final answer line that could be read
)

// grade reads a model's reply. Only the final answer line counts: the last
// line that starts the answer with the marker of any of the languages, so a
// model that reasons in another language than it was asked in is not
// penalised for it.
func grade(reply string, want answer) byte {
	final, ok := finalAnswer(reply)
	if !ok {
		return NoAnswer
	}
	if want.hint == hintNumber {
		n, ok := lastInteger(final)
		switch {
		case !ok:
			return NoAnswer
		case n == want.number:
			return Solved
		}
		return Wrong
	}
	found := matchChoices(final, vocabulary(want.hint))
	switch {
	case len(found) == 0:
		return NoAnswer
	case len(found) == 1 && found[0] == want.choice:
		return Solved
	}
	return Wrong
}

var answerMarkers = func() []string {
	var out []string
	for _, l := range languages {
		out = append(out, fold(l.marker))
	}
	return out
}()

// finalAnswer returns the folded text after the last answer marker. When the
// marker ends its line, the answer is taken from the next line with text.
func finalAnswer(reply string) (string, bool) {
	lines := strings.Split(reply, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := fold(lines[i])
		for _, marker := range answerMarkers {
			at := strings.LastIndex(line, marker)
			if at < 0 {
				continue
			}
			rest, ok := strings.CutPrefix(strings.TrimSpace(line[at+len(marker):]), ":")
			if !ok {
				continue
			}
			if rest = strings.TrimSpace(rest); rest != "" {
				return rest, true
			}
			for _, next := range lines[i+1:] {
				if next = fold(next); next != "" {
					return next, true
				}
			}
			return "", false
		}
	}
	return "", false
}

var folder = strings.NewReplacer(
	// Markdown emphasis and code marks around the answer.
	"*", "", "_", "", "`", "", "#", "",
	// Full-width punctuation and the spaces used to group digits.
	"：", ":", "，", ",", "．", ".", "\u3000", " ", "\u00a0", " ", "\u202f", " ",
	// Digit grouping as written in LaTeX: 1{,}234 and 1\,234.
	"{,}", ",", `\,`, " ",
	"−", "-", "–", "-", "’", "'",
	// The one letter that folds to two.
	"ß", "ss",
)

// fold makes text comparable: lower case, no accents, no markdown marks, and
// full-width digits and punctuation as their plain forms.
func fold(s string) string {
	s = folder.Replace(strings.ToLower(s))
	s = strings.Map(func(r rune) rune {
		switch {
		case r >= '０' && r <= '９':
			return r - '０' + '0'
		case strings.ContainsRune("áàâä", r):
			return 'a'
		case strings.ContainsRune("éèêë", r):
			return 'e'
		case strings.ContainsRune("íìîï", r):
			return 'i'
		case strings.ContainsRune("óòôö", r):
			return 'o'
		case strings.ContainsRune("úùûü", r):
			return 'u'
		case r == 'ñ':
			return 'n'
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}

// A number is either digit groups of three behind a separator, as in 1,234,
// 1.234 or 1 234, or plain digits with an optional decimal part.
var numberPattern = regexp.MustCompile(`\d{1,3}(?:[.,' ]\d{3})+|\d+(?:[.,]\d+)?`)

// lastInteger returns the last number in s. Every expected answer is a whole
// number that is not negative, so a negative number or one with a decimal
// part is returned as -1, which matches nothing.
func lastInteger(s string) (int, bool) {
	spans := numberPattern.FindAllStringIndex(s, -1)
	if len(spans) == 0 {
		return 0, false
	}
	span := spans[len(spans)-1]
	token := s[span[0]:span[1]]
	if strings.HasSuffix(strings.TrimSpace(s[:span[0]]), "/") {
		return -1, true // the denominator of a fraction is not the answer
	}
	if lead, signed := strings.CutSuffix(s[:span[0]], "-"); signed {
		// A minus sign, not a hyphen inside a word or a range.
		if lead == "" || strings.HasSuffix(lead, " ") || strings.HasSuffix(lead, ":") {
			return -1, true
		}
	}
	groups := strings.FieldsFunc(token, func(r rune) bool { return !unicode.IsDigit(r) })
	digits := groups[0]
	switch {
	case len(groups) == 1:
	case grouped(groups):
		digits = strings.Join(groups, "")
	case len(groups) == 2 && strings.Trim(groups[1], "0") == "":
		// 42.0 is forty-two.
	default:
		return -1, true
	}
	n, err := strconv.Atoi(digits)
	if err != nil {
		return -1, true
	}
	return n, true
}

// grouped reports whether the digit groups are a number with thousands
// separators: one to three digits, then groups of exactly three.
func grouped(groups []string) bool {
	if len(groups[0]) > 3 {
		return false
	}
	for _, g := range groups[1:] {
		if len(g) != 3 {
			return false
		}
	}
	return true
}

// spelling is one accepted way to write a choice.
type spelling struct {
	text   string // folded
	choice int
	han    bool // written in Chinese characters, which have no word breaks
}

var vocabularies = func() [hintCount][]spelling {
	var out [hintCount][]spelling
	add := func(hint hintKind, choice int, words ...string) {
		for _, word := range words {
			s := spelling{text: fold(word), choice: choice}
			s.han = strings.ContainsFunc(s.text, func(r rune) bool { return unicode.Is(unicode.Han, r) })
			if !slices.Contains(out[hint], s) {
				out[hint] = append(out[hint], s)
			}
		}
	}
	for _, l := range languages {
		for i, word := range l.people {
			add(hintPerson, i, word)
		}
		for i, word := range l.cities {
			add(hintCity, i, word)
		}
		for i, word := range l.colours {
			add(hintColour, i, word)
			add(hintColour, i, l.colourAliases[i]...)
		}
		for i, word := range l.weekdays {
			add(hintWeekday, i, word)
			add(hintWeekday, i, l.weekdayAliases[i]...)
		}
	}
	// Longest first, so that a word is matched before any word inside it.
	for hint := range out {
		slices.SortStableFunc(out[hint], func(a, b spelling) int { return len(b.text) - len(a.text) })
	}
	return out
}()

// vocabulary lists every accepted spelling of every choice of one kind, in
// all languages: a correct answer counts in whichever language it is given.
func vocabulary(hint hintKind) []spelling {
	return vocabularies[hint]
}

// matchChoices returns the distinct choices named in folded text. A matched
// word is consumed, so a longer word never also counts as a shorter one
// inside it.
func matchChoices(text string, words []spelling) []int {
	var found []int
	for _, word := range words {
		for from := 0; ; {
			at := strings.Index(text[from:], word.text)
			if at < 0 {
				break
			}
			at += from
			end := at + len(word.text)
			if word.han || standsAlone(text, at, end) {
				if !slices.Contains(found, word.choice) {
					found = append(found, word.choice)
				}
				text = text[:at] + strings.Repeat(" ", len(word.text)) + text[end:]
			}
			from = end
		}
	}
	return found
}

// standsAlone reports whether text[start:end] is a whole word. Chinese
// characters around it do not join it: they are written without spaces.
func standsAlone(text string, start, end int) bool {
	joins := func(r rune) bool {
		return (unicode.IsLetter(r) || unicode.IsDigit(r)) && !unicode.Is(unicode.Han, r)
	}
	if start > 0 {
		if r, _ := utf8.DecodeLastRuneInString(text[:start]); joins(r) {
			return false
		}
	}
	if end < len(text) {
		if r, _ := utf8.DecodeRuneInString(text[end:]); joins(r) {
			return false
		}
	}
	return true
}
