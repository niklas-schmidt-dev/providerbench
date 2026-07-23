# ProviderBench

**Measured, not marketed.** An open benchmark for VPS and server providers —
compare the compute, memory, disk and network you actually get, and catch the
overselling hiding behind the spec sheet.

Live comparison: **[providerbench.dev](https://providerbench.dev)**

> ⚠️ The published dataset currently contains **illustrative sample data**
> (every file is marked `"sample": true`). First official runs are in
> progress — real, community-verifiable numbers replace them as reports land.

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
  --provider hetzner --plan cax21 --region fsn1 --price 7.55 \
  --json report.json
```

A full run takes ~90 seconds. `providerbench run --quick` finishes in ~20.

## The tests

| Test      | Measures | Overselling angle |
|-----------|----------|-------------------|
| `cpu`     | SHA-256 throughput, 1 core and all cores | scaling efficiency collapses on oversold hosts |
| `memory`  | copy bandwidth + pointer-chase latency | prefetch-proof, cache-proof |
| `disk`    | seq r/w, random 4K IOPS, fsync p50 | direct I/O, dedup-proof blocks, durability latency |
| `network` | latency, download, upload vs Cloudflare edge | neutral endpoint, no peering tricks |
| `steal`   | CPU steal %, consistency CV, p99/p50 | the kernel's own confession |

Full details: [the benchmark sources](https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests)

## Adding a test

Implement one interface, register it, done — see
[providerbench.dev/cli](https://providerbench.dev/cli) or
[CONTRIBUTING.md](CONTRIBUTING.md). Test ideas that would be great PRs:
PostgreSQL TPS, Redis ops/s, build-time benchmarks, sustained-load runs.

## Submitting results

1. `providerbench run --provider ... --plan ... --json report.json`
2. Add the file as `data/results/<provider>-<plan>.json`
3. Open a PR. Reports include full system info so others can verify.

## Repository layout

```
cmd/providerbench/   CLI entrypoint
internal/            benchmark framework + built-in tests (zero dependencies)
schema/              JSON schema for reports
data/results/        the public dataset, one JSON file per run
web/                 providerbench.dev (Next.js + shadcn/ui, deployed on Vercel)
```

Benchmarks are organized in **categories** — `compute` is live; `ai`
(inference TTFT/throughput) and `storage` (R2 vs S3 & friends) are planned.
A report's `category` field decides where it appears on the site.

## License

MIT — see [LICENSE](LICENSE). No affiliate links, no sponsored rankings, ever.
