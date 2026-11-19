# Compute protocol `compute-v2`

Status: immutable  
Schema: `schema_version: 2`  
Profiles: `standard`, `sustained`

This document fixes the meaning of reports carrying
`protocol_version: "compute-v2"`. A future methodology change must use a new
protocol identifier; existing reports are never reinterpreted.

## Standard profile

The standard profile runs the following deterministic suite:

| Test | Metric | Unit | Direction |
|---|---|---|---|
| CPU | `single_core_hash` | MB/s | higher |
| CPU | `multi_core_hash` | MB/s | higher |
| CPU | `scaling_efficiency` | % | higher |
| Memory | `copy_bandwidth` | GB/s | higher |
| Memory | `random_access_latency` | ns | lower |
| Disk | `seq_write` | MB/s | higher |
| Disk | `seq_read` | MB/s | higher |
| Disk | `rand_read_4k` | IOPS | higher |
| Disk | `fsync_latency_p50` | ms | lower |
| Network | `latency_p50` | ms | lower |
| Network | `download` | Mbps | higher |
| Network | `upload` | Mbps | higher |
| Consistency | `unit_time_p50` | ms | lower |
| Consistency | `consistency_cv` | % | lower |
| Consistency | `p99_over_p50` | ratio | lower |
| Consistency | `cpu_steal` | % | lower |

The CPU test hashes fixed 64 KiB buffers for three seconds on one logical CPU
and then on all logical CPUs. Scaling efficiency is the all-core throughput
divided by single-core throughput times the reported logical CPU count. It is
not a statement that a vCPU is a dedicated physical core.

The memory test copies between two 256 MiB buffers and performs a dependent
pointer chase through a fixed-seed 64 MiB permutation.

The disk test uses a 1 GiB file with unique block contents. Sequential write
includes the final `fsync`; sequential and random reads use direct I/O where
supported. Random reads are 4 KiB at queue depth four. Fsync latency is the
median of 50 write-and-sync rounds. Any write, sync or worker read failure
fails the result; partial samples do not produce metrics.

The network test uses the nearest `speed.cloudflare.com` edge. It measures
eight warmed small-request latencies after subtracting the endpoint's reported
server time, up to 200 MiB of downloads, and a 50 MiB upload.

The consistency test runs 400 calibrated fixed-work units and reports their
median, coefficient of variation and p99/median ratio. On Linux it also
saturates all logical CPUs for five seconds and reads steal ticks from
`/proc/stat`. These values are contention, throttling and tail-latency signals;
no single value or threshold proves overselling or a CPU-credit cliff.

## Cohort and ranking contract

A standard cohort is ranking-eligible only when all of the following hold:

- exactly ten independently provisioned, fresh samples exist;
- each sample has exactly three successful repeats numbered 1–3;
- all 30 reports contain the complete 16-metric suite above;
- protocol, profile, price basis, metric names, units and directions match;
- no report is quick, sampled, explicitly excluded or failed.

One missing or failed repeat excludes the entire cohort until the campaign is
repeated and documented. A replacement host must not be silently substituted
under an existing sample coordinate.

## Sustained profile

Defined on 2026-11-19. Before that date the profile was reserved by the schema
and no CLI could produce it, so no earlier report is affected.

The standard profile measures each workload for seconds. The sustained profile
asks whether that performance is still there after minutes: burstable plans,
CPU-credit schemes, fair-share throttling and storage burst buckets all look
perfect in a three-second test.

| Test | Metric | Unit | Direction |
|---|---|---|---|
| cpu_sustained | `initial_throughput` | MB/s | higher |
| cpu_sustained | `sustained_throughput` | MB/s | higher |
| cpu_sustained | `retained` | % | higher |
| cpu_sustained | `worst_window` | % | higher |
| cpu_sustained | `window_cv` | % | lower |
| cpu_sustained | `cpu_steal` | % | lower |
| disk_sustained | `initial_write_iops` | IOPS | higher |
| disk_sustained | `sustained_write_iops` | IOPS | higher |
| disk_sustained | `retained` | % | higher |
| disk_sustained | `worst_window` | % | higher |
| disk_sustained | `window_cv` | % | lower |

Both tests run one continuous workload and read its progress counter every ten
seconds. A window's rate is the work completed in it divided by its measured
length.

- `initial_*` is the mean rate of the first three windows (30 s).
- `sustained_*` is the mean rate of the last six windows (60 s).
- `retained` is sustained over initial, in percent. It may exceed 100.
- `worst_window` is the slowest window relative to the median window.
- `window_cv` is the coefficient of variation across all windows.

`cpu_sustained` hashes on every logical CPU for ten minutes with the same
SHA-256 kernel as the standard CPU test, so its first windows line up with
`multi_core_hash`. `cpu_steal` is read from `/proc/stat` across the whole run
and exists on Linux only.

`disk_sustained` first lays out a 1 GiB file of unique blocks and syncs it,
untimed. It then overwrites random aligned 4 KiB blocks at queue depth four
for five minutes, with direct I/O where supported and a fresh counter in every
block. The file is synced once at the end; a failed write or sync fails the
result.

The result notes carry the complete window trace and the start of the first
window after the initial three that fell below 80% of the initial rate, if
any. A slow first window is a warm-up, not a throttle; `worst_window` reports
it.

A sustained report is never quick and never enters the composite ranking.
`--duration` shortens both tests for exploration; such a report is marked
`exclude_from_aggregate`, records `environment.sustained_duration`, and is an
audit-trail pilot, not cohort evidence. It takes a whole number of 10-second
windows, at least nine.

The versioned-method rule follows the reproducibility principle that published
results remain interpretable under the method used to produce them. See the
[SPEC benchmark disclosure policy](https://www.spec.org/osg/policy/).
