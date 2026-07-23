# Contributing to ProviderBench

Three ways to contribute, in ascending order of effort:

## 1. Submit benchmark results

```sh
go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest
providerbench run --provider <name> --plan <plan> --region <region> --price <eur> --json report.json
```

- Run on a **fresh** instance with nothing else running.
- Run at least twice at different times of day; submit the typical run, not the best one.
- Name the file `data/results/<provider>-<plan>.json` and open a PR.
- Reports include full system info (never your hostname) so others can verify.
- Don't hand-edit the JSON — reports that don't match the schema in
  `schema/result.schema.json` are rejected in review.

## 2. Add a benchmark test

Every test is one file in `internal/tests/` implementing one interface:

```go
func init() { bench.Register(myTest{}) }

type myTest struct{}

func (myTest) Name() string        { return "mytest" }
func (myTest) Description() string { return "one line" }
func (myTest) Run(ctx context.Context, opts Options) (*bench.Result, error) { ... }
```

Ground rules for tests (see the [methodology](https://providerbench.dev/methodology)):

- **Deterministic**: fixed seeds, identical work on every machine.
- **Cache-honest**: if the number can be faked by a cache, bypass the cache.
- **Cross-platform**: guard platform-specific code with build tags and degrade
  gracefully (report a note, not an error).
- **Zero dependencies**: the CLI stays a static binary built from the stdlib.

## 3. Propose a category

Categories group benchmarks on the site (`compute` is live; `ai` and
`storage` are planned). A category needs: a test suite in the CLI (or a
dedicated runner), a `category` value in the report JSON, and an entry in
`web/src/lib/categories.ts`. Open an issue with proposed metrics first —
methodology gets debated before code.

## Website

```sh
cd web && bun install && bun dev
```

Next.js + Tailwind v4 + shadcn/ui (Base UI) + Motion. Provider chart colors
live in `web/src/lib/providers.ts` — the slot order is a validated
colorblind-safe sequence; add new providers to the end, never re-shuffle.

## Ground rules

- No affiliate links, no sponsored anything. PRs adding them are closed.
- Sample/placeholder data must be marked `"sample": true` — it renders with a
  warning banner and never mixes with real measurements.
