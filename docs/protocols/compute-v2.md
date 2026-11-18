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

`sustained` is reserved by schema but is not implemented by the v0.2 CLI.

The versioned-method rule follows the reproducibility principle that published
results remain interpretable under the method used to produce them. See the
[SPEC benchmark disclosure policy](https://www.spec.org/osg/policy/).
