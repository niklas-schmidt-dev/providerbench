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
- A `compute-v2` standard cohort needs exactly **10 independently provisioned
  hosts with 3 successful repeats each** per provider/product/plan/region.
  Do not repeatedly benchmark one lucky VM or silently replace a failed sample.
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
- Ten hosts are enough to enter the standard ranking. Treat P99 as a
  descriptive observed-tail estimate for this fixed 10-host design.
- Reports include full system info (never your hostname) so others can verify.
- Every report and individual benchmark must retain its UTC timestamp. Re-runs
  at a later date use a new campaign ID; historical cohorts are never pooled.
- Don't hand-edit the JSON. Run
  `providerbench validate --manifest data/report-manifest.json data/results`
  before opening the PR. CI verifies the schema selected by `schema_version`,
  all cohort invariants, the naming convention, and byte-for-byte manifest
  drift. Schema v1 remains the immutable legacy contract; new runs use strict
  schema v2 and `protocol_version: "compute-v2"`.

For supported provider lifecycles, use the managed Go commands instead of an
ad-hoc shell script:

```sh
providerbench campaign hetzner --help
providerbench campaign digitalocean --help
providerbench campaign vercel --help
```

The Vercel command defaults to 10 fresh Sandboxes with 3 repeats per Sandbox
and creates them sequentially. Hetzner creates its 10-host cohort in a spread
placement group. DigitalOcean selects the cheapest matching Basic 2-vCPU/4-GiB
size in `fra1` and requests all 10 tagged Droplets together. Every runner
benchmarks sequentially, refuses to overwrite campaign reports, and requires
`--confirm-cost` for live provisioning.

## 2. Add a benchmark test

Every test is one file in `internal/tests/<category>/`, named after the test,
implementing one interface:

```go
func init() { bench.Register(myTest{}) }

type myTest struct{}

func (myTest) Name() string        { return "mytest" }
func (myTest) Description() string { return "one line" }
func (myTest) Run(ctx context.Context, opts Options) (*bench.Result, error) { ... }
```

A test belongs to a category through `Category()` and, when it is long
running, to the sustained profile through `Profile()`; without them it is a
standard compute test. The standard compute suite is frozen at the five tests
of `compute-v2` — a ranked cohort must contain exactly its 16 metrics — so a
new test goes into another category, into a profile, or into a new protocol
version, never into that suite.

Ground rules for tests (the benchmark source is the methodology):

- **Deterministic**: fixed seeds, identical work on every machine. Generate
  inputs with integer arithmetic: floating-point library functions differ in
  their last bit between CPUs, and with them the input.
- **Self-checking**: verify the output of the work you time. A platform that
  computes the wrong answer must fail, not post a fast number.
- **Cache-honest**: if the number can be faked by a cache, bypass the cache.
- **Cross-platform**: guard platform-specific code with build tags and degrade
  gracefully (report a note, not an error).
- **Self-contained workloads**: benchmark tests use the standard library and
  the CLI remains a static binary. Provider orchestration may use the
  provider's maintained Go SDK.

## 3. Propose a category

Categories group benchmarks on the site. `compute` is live. Four more ship in
this CLI under their own pinned protocols and await their first published
campaigns: `storage` (`providerbench run -t s3`, `storage-v1`), `workload`
(`workload-v1`), `platform` (`platform-v1`) and `reach` (`reach-v1`). The
architectural rule is **category = runner, schema = contract**: a category is
not required to extend this CLI. The five above run as one static binary —
`storage` drives object stores from whatever vantage host the CLI runs on,
which is why its protocol records the vantage. A category whose workload
doesn't fit that shape gets its own runner (an AI suite would hit provider
APIs from a client).

A category needs three things in this repository: a protocol document in
`docs/protocols/`, an entry in `bench.ProtocolFor`, and the matching pin in
`schema/result-v2.schema.json`.

Every runner must satisfy the same contract: emit reports that pass
`providerbench validate`, carry campaign/sample/repeat coordinates, and land
as one JSON file per run in `data/results/`. The dataset is the interface —
the site never knows which runner produced a report, only its `category`
value and an entry in `web/src/lib/categories.ts`. Open an issue with
proposed metrics first — methodology gets debated before code.

## Website

```sh
cd web && bun install && bun dev
```

Next.js 16 (Turbopack) + React 19 + Tailwind v4 + TypeScript 7. Components
come from the shadcn registries in `web/components.json`: Base UI primitives,
the ReUI data grid, and beUI Pro blocks (command palette, 404). Installing a
beUI Pro block needs `BEUI_PRO_TOKEN`; ReUI blocks need `REUI_LICENSE_KEY`.
Free components and everything already in `src/` build without either.

The interface is deliberately monochrome: black, white and greys only. The
one exception is data. Each provider owns a `--provider-<slug>` token per
theme in `web/src/app/globals.css`, and the set is validated as one
colorblind-safe categorical palette. A new provider adds an entry in
`web/src/lib/providers.ts` and a token pair in `globals.css`; never re-color
an existing provider. Charts are hand-drawn SVG in
`web/src/components/charts/`. DM Sans and Geist Mono are bundled via
Fontsource, so production builds never fetch fonts.

`bun run test:e2e` builds the site and runs the Playwright smoke tests. It
honors `PORT`, so `portless run --name e2e bun run test:e2e` runs beside a
dev server.

## Ground rules

- No affiliate links, no sponsored anything. PRs adding them are closed.
- Sample/placeholder data must be marked `"sample": true` — it renders with a
  warning banner and never mixes with real measurements.
