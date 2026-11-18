# Storage protocol `storage-v1`

Status: immutable  
Schema: `schema_version: 2`  
Category: `storage`  
Profiles: `standard`

This document fixes the meaning of reports carrying
`protocol_version: "storage-v1"`. A future methodology change must use a new
protocol identifier; existing reports are never reinterpreted.

## Standard profile

The `s3` test drives any S3-compatible endpoint through the plain HTTP API
with AWS Signature Version 4, so every provider runs the identical workload:

| Test | Metric | Unit | Direction |
|---|---|---|---|
| S3 | `ttfb_p50` | ms | lower |
| S3 | `small_put_p50` | ms | lower |
| S3 | `small_put_p99` | ms | lower |
| S3 | `small_get_p50` | ms | lower |
| S3 | `small_get_p99` | ms | lower |
| S3 | `list_p50` | ms | lower |
| S3 | `upload_throughput` | MB/s | higher |
| S3 | `download_throughput` | MB/s | higher |

The workload, in order, under a unique per-run key prefix:

- one untimed 16 KiB warm-up PUT that verifies credentials and permissions;
- 40 sequential 16 KiB PUTs of unique, incompressible payloads — the
  latencies form `small_put_p50`/`small_put_p99`;
- 40 sequential GETs of those objects on warm connections. Time to the first
  payload byte forms `ttfb_p50`; the full read forms
  `small_get_p50`/`small_get_p99`;
- one 64 MiB single-request PUT and one full GET of the same object —
  transfer time only, payload pre-generated, forming `upload_throughput` and
  `download_throughput`;
- nine `ListObjectsV2` calls on the run prefix, first discarded as warm-up,
  forming `list_p50`;
- deletion of every created object. Cleanup failures are reported as notes,
  never silently ignored.

Payloads are xorshift streams seeded from `crypto/rand`: neither compression
nor deduplication can flatter a provider. Requests sign with
`UNSIGNED-PAYLOAD` so body hashing never contaminates a timing. Path-style
addressing is the default; virtual-hosted addressing is recorded in the
result notes when used. `--quick` shrinks the workload (12 small objects,
16 MiB large object) and is never ranked.

The endpoint URL, bucket name and credentials come from the environment
(`PB_S3_*`) and are deliberately absent from the report.

## The vantage point is part of the method

Object-storage numbers measure the endpoint *and* the network path from the
machine running the test. Dataset reports therefore record:

- `provider.region`: the bucket's region as sold by the provider;
- `environment.vantage`: where the test ran, e.g. `hetzner-fsn1` — required
  for dataset submissions;
- the vantage host's own network capacity, measured with the compute
  `network` test, must comfortably exceed the observed storage throughput —
  otherwise the report measures the client, not the store, and must not be
  submitted.

## Cohort and ranking contract

A standard cohort is ranking-eligible only when all of the following hold:

- exactly ten independently provisioned, fresh vantage hosts exist, all in
  one documented vantage region;
- each sample has exactly three successful repeats numbered 1–3;
- all 30 reports contain the complete 8-metric suite above;
- protocol, profile, endpoint region, vantage, metric names, units and
  directions match;
- no report is quick, sampled, explicitly excluded or failed.

One missing or failed repeat excludes the entire cohort until the campaign is
repeated and documented.

`providerbench campaign storage` produces conforming cohorts: it provisions
the fresh Hetzner vantage fleet in one spread placement group, delivers the
`PB_S3_*` credentials over SSH stdin (never via command lines), records the
vantage in every report, and removes credentials and hosts afterwards.
