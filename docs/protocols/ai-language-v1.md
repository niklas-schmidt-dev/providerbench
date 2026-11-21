# AI language protocol `ai-language-v1`

Status: draft — frozen when the first report is published  
Schema: `schema_version: 2`  
Category: `ai-language`  
Profiles: `standard`

This document fixes the meaning of reports carrying
`protocol_version: "ai-language-v1"`. Until the first report lands in
`data/results/` the method may still be corrected; from then on a change needs
a new protocol identifier and existing reports are never reinterpreted.

The difficulty levels were tuned once against real models, in November 2026
(see [The problems](#the-problems)). The strongest of them still solve nearly
everything in every language, so the suite separates languages for models
below that and has no headroom above it.

## Why this suite exists

Model benchmarks are mostly run in English. A model that is used in German,
Spanish or Chinese may reason just as well there, or it may not, and a single
English score cannot say which.

This suite asks a model the same problems in four languages and compares the
results problem by problem. Unlike every other suite, it measures the model
behind an API, not the machine the benchmark runs on.

## Standard profile

Five tests, each a family of reasoning problems. Every test reports one
metric per language:

| Test | Metrics | What a problem asks |
|---|---|---|
| `arithmetic` | `accuracy_en`, `accuracy_de`, `accuracy_es`, `accuracy_zh` | Keep the stock of two warehouses through a list of deliveries, shipments, transfers, doublings and halvings. Every quantity is spelled out in words. |
| `ordering` | same four | People are compared by age, one neighbouring pair per sentence, in shuffled order. Name the person in a given place of the full line. |
| `reading` | same four | A text of shuffled facts says where each person lives, which colour each likes and to whom each writes. Follow the letters for a number of steps and name the city or colour of the person reached. |
| `procedure` | same four | Apply a numbered list of written steps to a list of numbers: remove, sort, reverse, swap, add, multiply. Report the first or last number, the sum or the count. |
| `calendar` | same four | Given the weekday of one date, name the weekday of another date in the same year. |

All metrics are the share of problems answered correctly, in percent; higher
is better. The language codes are `en` English, `de` German, `es` Spanish and
`zh` Chinese (simplified).

### The problems

Each test has 40 problems: eight at each of five difficulty levels. A level
adds steps, people or distance:

| Test | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|---|---|---|---|---|---|
| `arithmetic`: events (quantities up to 99 at level 1, then 999) | 10 | 20 | 40 | 80 | 160 |
| `ordering`: people | 5 | 8 | 12 | 16 | 20 |
| `reading`: people, steps | 6, 3 | 9, 6 | 12, 12 | 15, 25 | 18, 50 |
| `procedure`: numbers, steps | 8, 5 | 12, 10 | 20, 15 | 30, 25 | 45, 40 |
| `calendar`: months between the dates | 0 | 1 | 2 to 3 | 4 to 6 | 7 to 9 |

The sizes come from a trial with six models in November 2026. At the first
draft's sizes (at most 14 events, 18 people, 9 steps) seven of eight models
solved every problem in every language, which shows nothing. `reading` was
still solved by all six at the largest size its text allows, and `calendar`
cannot be made longer. Both stay in as the check that plain comprehension is
equal across the languages.

A problem is generated once from a fixed seed, as a structure without any
language in it: quantities, people, a list of events. It is then written out
in each language from that one structure, sentence for sentence. The four
versions therefore state the same facts in the same order and have the same
answer. A difference between a model's scores is a difference in how it
handles the language.

The problems are generated, not collected from existing tests, so a model
cannot have read them in training before this protocol was published. The
generator uses its own integer arithmetic, so the set is identical on every
machine and Go release. The SHA-256 over all 800 prompts and answers is pinned
in the test suite:

```
2b36a39f41e04ebe031c275a87f47cb561208a56869e9fad4df1d12a6f43b30f
```

Three choices keep the languages comparable:

- Quantities before a noun never end in one and are never below twelve. Those
  are the numbers that change form before a noun in German, Spanish or
  Chinese, and a wrong form would be the benchmark's mistake, not the
  model's.
- Dates run from March to December, so no answer depends on a leap year.
- Names of people are the same in English, German and Spanish and
  transliterated in Chinese. Cities, colours and weekdays use each
  language's own words.

The wording in all four languages was proofread for meaning that differs from
the English version. It has not been reviewed by native speakers.

### How a model is asked

One request per problem and language: a single user message holding the
problem, a request to solve it step by step, and the form of the final line
(`Answer:`, `Antwort:`, `Respuesta:` or `答案：`). There is no system prompt.
A full run is 800 requests; they go out problem by problem with the four
languages next to each other, so a change at the provider during the run
touches every language alike.

Nothing is sent that changes how the model answers unless the report says so:

| Setting | Sent | Recorded as |
|---|---|---|
| Reasoning effort | only when `PB_AI_EFFORT` is set | `environment.ai_effort` |
| Output limit per answer | 32,000 tokens on the Anthropic API, which requires one; nothing on OpenAI-compatible endpoints unless `PB_AI_MAX_TOKENS` is set | `environment.ai_max_tokens` |
| Sampling (temperature and others) | never: current models reject them | `environment.ai_sampling` |

The report also records the API kind (`ai_api`) and the host the requests went
to (`ai_endpoint`), so a gateway or proxy in front of a model is visible.
Requests go to that host and no other. A redirect is not followed, and on the
Anthropic API the address is `ANTHROPIC_BASE_URL` or `api.anthropic.com`: one
named in a configuration profile is not used.

The report names the model that was asked for. When the endpoint says another
model answered, a note on each result lists the names it gave: a gateway can
map one model name to another, and an alias resolves to a dated name.

On the Anthropic API a declined request can be re-served by another model.
That fallback is not used: the report would describe a model it did not
measure. A declined request is a problem the model did not solve.

A request that fails is repeated: up to five times when the API marks the
failure as temporary, and the whole request twice more after that, because a
gateway can fail a single request without saying so. A request that still
fails ends the test with an error and no metrics. A credential that an
endpoint repeats in its error message is removed from the error text. An unanswered problem is not a wrong answer, and a partial test
would change what the percentages cover.

### Scoring

Only the final answer line counts: the last line in which one of the four
answer words is followed by a colon. The word of any language is accepted, so
a model that reasons in another language than it was asked in loses nothing
for that. No second model judges the answer.

- Numbers: the last number in that line must equal the expected whole number.
  Thousands separators (`1,234`, `1.234`, `1 234`, and `1{,}234` as written in
  LaTeX), full-width digits and a unit after the number are read. A number in
  words is not, and neither is a number directly after a slash, as in
  `1/1234`.
- Names, cities, colours and weekdays: the line must name exactly one of the
  possible answers, and it must be the right one. A correct answer counts in
  any of the four languages and with or without accents.

Each test also stores one character per problem and language in
`results[].outcomes`: `1` solved, `0` wrong, `-` no final answer line that
could be read (including replies cut off at the output limit and declined
requests). The validator checks that every `accuracy_*` metric equals the
share of `1` in its outcome string, and that every test that succeeded
appears once with all four languages and all its problems. The notes of a result count the `-`
cases by cause, and give the mean output tokens per reply for each language.

`--quick` asks the first two problems of each level: 10 per test, 200
requests in all. Quick reports are never ranked.

## Reading a report

`providerbench run` prints a summary after the per-test table, and
`providerbench languages FILE|DIR ...` prints one row per report to compare
models. Both come from the outcome strings alone:

- the share of all problems solved in each language, and
- the difference to English in percentage points, with a 95% interval.

A summary counts the tests that have outcomes. When a report lacks a test of
the suite, because it was not run or it failed, both commands name what is
missing: such a report is not about the same problems as a complete one.

The interval is a paired bootstrap over problems: 10,000 resamples with a
fixed seed, drawing problems within each test and keeping the two answers to
a problem together. Because the same problem is asked in both languages, this
removes the spread between easy and hard problems and leaves the effect of the
language. A language is called "below English" or "above English" only when
the whole interval lies on one side of zero.

With 200 problems, a difference of a few percentage points is usually inside
the interval. One run of a model is one sample of its answers: a second run
can differ, because no sampling parameter is fixed.

## What it does not measure

- How well a model writes in a language. Answers are a number or one word,
  and they are accepted in any of the four languages.
- Knowledge of a culture, its idioms or its literature. The problems need no
  knowledge beyond the calendar.
- Open-ended work such as writing, translating, coding or using tools.
- Speed and price. Output tokens per language are in the notes; time to first
  token and throughput belong to a separate suite.
- Anything about English as such. English is the baseline the others are read
  against, not a neutral point: a model can be worse in English than in
  another language, and the summary then says "above English".

## Report identity

The model is the report's `plan`, and the party serving it is the `provider`:
`anthropic`, `openai`, or the host of another endpoint. The product is `api`
and the region `global` unless the identity flags say otherwise; `--plan` must
equal `PB_AI_MODEL`. `system` describes the machine that sent the requests and
has no bearing on the results.

Repeated runs of one model can share a campaign: each run is a
`sample_index`. The validator checks report structure, campaign coordinates,
metric definitions and outcome consistency. It defines no composite ranking
for this category.

## Running it

```
PB_AI_API=anthropic PB_AI_MODEL=claude-opus-5-5 \
    providerbench run --category ai-language

PB_AI_API=openai PB_AI_BASE_URL=http://localhost:1234/v1 PB_AI_MODEL=local-model \
    providerbench run --category ai-language --quick

providerbench languages reports/
```

`PB_AI_API` is `anthropic` for Claude models (credentials are resolved by the
Anthropic SDK) or `openai` for any endpoint that implements chat completions.
`PB_AI_TRANSCRIPT=FILE` appends every prompt and reply as JSON lines, which is
the way to see why a model lost a point. Answers received before a request
failed are written as well. Requests are billed by the provider:
`--quick` is the cheap way to try a model.
