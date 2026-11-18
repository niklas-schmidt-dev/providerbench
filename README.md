# ProviderBench

**Measured, not marketed.** An open benchmark for VPS and server providers —
compare the compute, memory, disk and network you actually get, including
contention and consistency signals that do not appear on a spec sheet.

Live comparison: **[providerbench.dev](https://providerbench.dev)**

The published dataset contains raw, dated measurements. A compute-v2 plan
enters the ranking only with its complete 10-host × 3-repeat cohort; partial or
failed campaigns remain visibly provisional audit data.

## Why

Every provider sells "vCPUs" and "NVMe". None of them sell you the numbers
that matter: how much CPU time the hypervisor steals under load, how much
run-to-run variance your neighbors cause, and what an `fsync` really costs.
ProviderBench measures all of it with one static binary and publishes every
result as plain JSON anyone can reproduce or dispute.

## Quick start

```sh
go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest

providerbench run \
  --provider hetzner --product cloud-vps --plan cpx22 --tier medium \
  --region fsn1 --price-month 19.49 --price-hour 0.0312 \
  --campaign hetzner-2026q3 --sample-index 1 --repeat-index 1 \
  --fresh-instance \
  --json report.json
```

A full run takes ~90 seconds. `providerbench run --quick` finishes in ~20.

## Managed Hetzner campaigns

Hetzner provisioning is part of the Go CLI; it does not require `hcloud` or
`jq`. Build one Linux benchmark binary, inspect the resource plan, then run it:

```sh
GOOS=linux GOARCH=amd64 go build -o bin/providerbench-linux-amd64 ./cmd/providerbench

providerbench campaign hetzner --dry-run \
  --campaign hetzner-2026q3 --plan cpx22 --tier medium --region fsn1 \
  --price-hour 0.032 --price-month 19.99

HCLOUD_TOKEN=... providerbench campaign hetzner --confirm-cost \
  --campaign hetzner-2026q3 --plan cpx22 --tier medium --region fsn1 \
  --price-hour 0.032 --price-month 19.99
```

By default the command creates 10 fresh hosts in a Hetzner spread placement
group and takes 3 measurements on each host. All hosts must exist together for
Hetzner to place them on different physical hosts, so the remaining hosts are
intentionally idle while one host is measured. Each server is deleted
immediately after its repeats finish. Signal and error cleanup uses a separate
timeout so cancellation still removes billable resources.

The API token is read only from `HCLOUD_TOKEN`; it is never accepted as a flag
or written into a report. `--confirm-cost` is required for a real campaign.
Use `providerbench campaign hetzner --help` for image, SSH, output, repeat, and
pricing-date options.

## Managed DigitalOcean campaigns

The DigitalOcean runner uses the official
[Godo SDK](https://docs.digitalocean.com/reference/libraries/) and reads
`DIGITALOCEAN_TOKEN` only from the environment. It queries the live size
catalog and selects the cheapest available shared-CPU **Basic** Droplet in
`fra1` with exactly 2 vCPUs and 4096 MiB.

```sh
providerbench campaign digitalocean --dry-run \
  --campaign digitalocean-2026q3 \
  --ssh-key-fingerprint aa:bb:cc:dd \
  --usd-to-eur 0.85 \
  --pricing-as-of 2026-07-24

DIGITALOCEAN_TOKEN=... providerbench campaign digitalocean --confirm-cost \
  --campaign digitalocean-2026q3 \
  --ssh-key-fingerprint aa:bb:cc:dd \
  --usd-to-eur 0.85 \
  --pricing-as-of 2026-07-24
```

The command requests all ten tagged Droplets together, then takes three
sequential measurements on each host. Every successful host is destroyed as
soon as its repeats finish; cancellation and failures trigger a separate
cleanup context for every remaining Droplet. The report preserves the original
USD API price, the explicit EUR-per-USD conversion rate, and its observation
date. `--confirm-cost` is mandatory and `--dry-run` performs no API call.

## Managed Vercel Sandbox campaigns

Vercel orchestration also lives in the Go CLI. ProviderBench uses the supported
[Vercel Sandbox][vercel-sandbox] CLI only for authentication and transport; the
sample/repeat plan, report validation, collision checks, and cleanup are
implemented in Go.

```sh
vercel sandbox login

providerbench campaign vercel --dry-run \
  --campaign vercel-sandbox-2026-07-24 --vcpus 2 \
  --price-hour 0.2991573034 --price-month 218.3848315 \
  --pricing-as-of 2026-07-23 \
  --pricing-basis '2*$0.128 active-vCPU-hour + 4GB*$0.0212 GB-hour; ECB 2026-07-23 EUR/USD 1.1392; 730h continuous full utilization; excludes included quota, creation, and network'

providerbench campaign vercel --confirm-cost \
  --campaign vercel-sandbox-2026-07-24 --vcpus 2 \
  --price-hour 0.2991573034 --price-month 218.3848315 \
  --pricing-as-of 2026-07-23 \
  --pricing-basis '2*$0.128 active-vCPU-hour + 4GB*$0.0212 GB-hour; ECB 2026-07-23 EUR/USD 1.1392; 730h continuous full utilization; excludes included quota, creation, and network'
```

This requires Vercel CLI 54.15.1 or newer and a linked Vercel project (or
explicit `--project` and `--scope`). ProviderBench never accepts a Vercel token
flag; credentials remain in Vercel's auth store or `VERCEL_AUTH_TOKEN`.

The default campaign takes 3 measurements on each of 10 fresh Sandboxes, for
30 raw reports. Sandboxes are created, benchmarked, and permanently removed
one at a time, so there is no fleet sitting idle during a sequential test.
Each report records the campaign, independent sample, technical repeat, runtime,
CLI version, measurement timestamps, price observation date, and pricing basis.

Vercel Sandbox is usage-priced rather than a fixed monthly server. The example
therefore records a transparent continuous-full-utilization equivalent for a
2-vCPU/4-GB Sandbox, based on [Vercel's published Sandbox prices][vercel-pricing]
and the [ECB reference rate][ecb-fx]. Included quota and other metered items are
kept out of the price/performance denominator and called out in the report.
Vercel currently exposes Sandbox in `iad1`; the CLI stores that region rather
than pretending this is a multi-region cohort.

[vercel-sandbox]: https://vercel.com/docs/sandbox
[vercel-pricing]: https://vercel.com/pricing
[ecb-fx]: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html

## The tests

| Test      | Measures | Interpretation |
|-----------|----------|----------------|
| `cpu`     | SHA-256 throughput, 1 core and all cores | scaling efficiency across reported logical CPUs |
| `memory`  | copy bandwidth + pointer-chase latency | prefetch-proof, cache-proof |
| `disk`    | seq r/w, random 4K IOPS, fsync p50 | direct I/O, dedup-proof blocks, durability latency |
| `network` | latency, download, upload vs Cloudflare edge | neutral endpoint, no peering tricks |
| `steal`   | unit-time p50, CPU steal %, consistency CV, p99/p50 | contention, throttling and tail-latency signals |

Full details: [the benchmark sources](https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests)
and the immutable
[`compute-v2` methodology](docs/protocols/compute-v2.md).

## Adding a test

Implement one interface, register it, done — see
[providerbench.dev/cli](https://providerbench.dev/cli) or
[CONTRIBUTING.md](CONTRIBUTING.md). Test ideas that would be great PRs:
PostgreSQL TPS, Redis ops/s, build-time benchmarks, sustained-load runs.

## Submitting results

1. Create a campaign and run the same plan on exactly **10 fresh instances**.
2. If you repeat a benchmark on one host, keep the same `--sample-index` and
   record exactly repeats 1, 2 and 3; repeats are reduced to one per-host median.
   `--campaign`, `--sample-index`, and `--repeat-index` travel together — the
   CLI refuses a campaign run without explicit coordinates.
3. Add every raw file under
   `data/results/<provider>-<product>-<plan>-<region>-<campaign>-<sample>-<repeat>.json`.
4. Run
   `providerbench validate --manifest data/report-manifest.json data/results`,
   then open a PR — CI enforces the same contract and manifest. Reports include
   full system info so others can verify.

Prices are **net EUR, excluding VAT** — tax depends on the buyer's country,
not the provider. `--quick` runs are recorded as such in the report and never
enter ranked aggregates: quick workloads are smaller and not comparable.

Every report and every workload carries its own UTC timestamp. Use a new
`--campaign` ID whenever a provider, plan, and region are re-measured: the site
keeps historical campaigns separate, uses the latest complete cohort for
headline comparisons, and plots older cohorts as a performance timeline.

The site ranks the cross-host **P50**, not the luckiest VM. It also publishes
the mean, P10, P90, and P99. A plan remains visibly provisional until the
complete 10-host × 3-repeat cohort exists; P99 is explicitly labelled a
descriptive observed-tail estimate for that fixed design.

The performance index is a transparent weighted geometric mean across CPU,
memory, disk, network, and consistency. A cohort only enters the ranking with
the full metric suite — a CPU-only campaign cannot earn a composite score.
Price/performance uses the net monthly price, excluding VAT. When a plan was
tested in multiple regions, its best region median appears in the global
comparison while all locations remain visible on the provider page.

## Repository layout

```
cmd/providerbench/   CLI entrypoint
internal/            benchmark framework + built-in tests (zero dependencies)
schema/              JSON schema for reports
data/results/        the public dataset, one JSON file per run
web/                 providerbench.dev (Next.js + local Base UI components)
```

Benchmarks are organized in **categories** — `compute` is live; `ai`
(inference TTFT/throughput) and `storage` (R2 vs S3 & friends) are planned.
A report's `category` field decides where it appears on the site.

## License

MIT — see [LICENSE](LICENSE). No affiliate links, no sponsored rankings, ever.
