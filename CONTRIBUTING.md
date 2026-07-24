# Contributing to ProviderBench

Three ways to contribute, in ascending order of effort:

## 1. Submit benchmark results

```sh
go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest
providerbench run \
  --provider hetzner --product cloud-vps --plan cpx22 --tier medium \
  --region fsn1 --price-month 19.49 --price-hour 0.0312 \
  --campaign hetzner-2026q3 --sample-index 1 --repeat-index 1 \
  --fresh-instance \
  --env os_image=ubuntu-24.04 \
  --json report.json
```

- `--provider` is the **company** (hetzner, vercel, aws); `--product` is the
  offering you tested (cloud-vps, sandbox, ec2). One company, many products.
- `--env` (repeatable) carries the reproducibility detail: OS image, service
  versions, non-default config. Everything needed to reproduce the run lives
  in the public report — the site only shows a summary.
- A ranked campaign needs at least **10 independently provisioned hosts** per
  provider/product/plan/region. Do not repeatedly benchmark one lucky VM and
  present those runs as independent samples.
- Use one `--campaign` ID. Increment `--sample-index` for every fresh host and
  `--repeat-index` for technical repeats on the same host. The CLI refuses a
  campaign run without explicit coordinates, and the site collapses any
  index-less campaign runs into a single host — repeats can never pose as
  independent samples.
- Prices are net EUR, excluding VAT. `--quick` runs are recorded in the report
  and never enter ranked aggregates.
- The aggregator first takes the median of repeats on each host, then computes
  the mean, P10, P50, P90, and P99 across hosts. P50 is the headline result.
- Name files
  `data/results/<provider>-<product>-<plan>-<region>-<campaign>-<sample>-<repeat>.json`
  and submit every raw observation, not a hand-picked representative.
- Ten hosts are enough to enter the ranking and estimate P90. Treat P99 as an
  observed-tail estimate until the campaign reaches 100 independent hosts.
- Reports include full system info (never your hostname) so others can verify.
- Every report and individual benchmark must retain its UTC timestamp. Re-runs
  at a later date use a new campaign ID; historical cohorts are never pooled.
- Don't hand-edit the JSON — reports that don't match the schema in
  `schema/result.schema.json` are rejected in review.

For supported provider lifecycles, use the managed Go commands instead of an
ad-hoc shell script:

```sh
providerbench campaign hetzner --help
providerbench campaign vercel --help
```

The Vercel command defaults to 10 fresh Sandboxes with 3 repeats per Sandbox.
It creates and removes Sandboxes sequentially. The Hetzner command creates its
10-host cohort together so a spread placement group can distribute hosts, then
benchmarks and removes them sequentially. Both commands refuse to overwrite an
existing campaign report and require `--confirm-cost` for live provisioning.

## 2. Add a benchmark test

Every test is one file in `internal/tests/compute/` implementing one interface:

```go
func init() { bench.Register(myTest{}) }

type myTest struct{}

func (myTest) Name() string        { return "mytest" }
func (myTest) Description() string { return "one line" }
func (myTest) Run(ctx context.Context, opts Options) (*bench.Result, error) { ... }
```

Ground rules for tests (the benchmark source is the methodology):

- **Deterministic**: fixed seeds, identical work on every machine.
- **Cache-honest**: if the number can be faked by a cache, bypass the cache.
- **Cross-platform**: guard platform-specific code with build tags and degrade
  gracefully (report a note, not an error).
- **Self-contained workloads**: benchmark tests use the standard library and
  the CLI remains a static binary. Provider orchestration may use the
  provider's maintained Go SDK.

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
