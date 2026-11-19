# Workload protocol `workload-v1`

Status: draft — frozen when the first cohort is published  
Schema: `schema_version: 2`  
Category: `workload`  
Profiles: `standard`

This document fixes the meaning of reports carrying
`protocol_version: "workload-v1"`. Until the first cohort lands in
`data/results/` the method may still be corrected; from then on a change needs
a new protocol identifier and existing reports are never reinterpreted.

## Why this suite exists

`compute-v2` measures the CPU by hashing with SHA-256. That is deterministic
and cache-proof, but it is decided by one instruction-set extension. In the
public dataset the same plan lands on hosts with and without SHA instructions,
and `single_core_hash` differs 5.5× between them while the same hosts' memory
access latency differs by nothing measurable. A buyer's JSON encoder does not
get 5.5× faster.

The kernels in this suite are ordinary compiled Go from the standard library:
compressing, parsing, sorting, hashing into a map, allocating. Where they
reach hand-written assembly it is the runtime's memory-copy, byte-search and
map-hash helpers, which use instructions every x86-64 and arm64 server CPU has
had for a decade. `tls` is the exception by design: it is real cryptography
and uses what the CPU offers, as a web server does.

The claim was checked on one machine by switching the SHA instructions off for
the benchmark process (`GODEBUG=cpu.sha=off`), three interleaved runs each
way. `cpu.single_core_hash` fell from 4,584 to 684 MB/s, a loss of 85%. The
medians of `compress`, `json`, `sort`, `kv`, `alloc` and `http` moved by less
than 5%, inside their run-to-run spread. `tls.multi_core` lost 7%, because a
TLS handshake does hash.

## Standard profile

| Test | Metric | Unit | Direction |
|---|---|---|---|
| compress | `single_core` | MB/s | higher |
| compress | `multi_core` | MB/s | higher |
| json | `single_core` | MB/s | higher |
| json | `multi_core` | MB/s | higher |
| sort | `single_core` | Mkeys/s | higher |
| sort | `multi_core` | Mkeys/s | higher |
| kv | `single_core` | Mops/s | higher |
| kv | `multi_core` | Mops/s | higher |
| alloc | `single_core` | Mobjects/s | higher |
| alloc | `multi_core` | Mobjects/s | higher |
| tls | `single_core` | handshakes/s | higher |
| tls | `multi_core` | handshakes/s | higher |
| http | `requests` | req/s | higher |
| http | `latency_p50` | us | lower |
| http | `latency_p99` | us | lower |

The six two-metric tests share one harness. A kernel runs for three seconds on
one worker, then for three seconds on one worker per usable CPU. Workers are
set up before the clock starts and every worker owns its buffers.

"Usable CPUs" is the Go runtime's parallelism (`GOMAXPROCS`): the logical CPUs
of the machine, capped by a container CPU quota where one applies. A container
sold as two CPUs through a quota still shows every core of its host; one
worker per visible core would measure the scheduler taking turns.

- **compress** round-trips 512 KiB of text through DEFLATE at level 6:
  compress, decompress, compare. Throughput counts the uncompressed bytes.
- **json** encodes 1,000 API-shaped records (about 470 KiB) and decodes them
  into fresh values. Throughput counts the JSON bytes.
- **sort** sorts 1,048,576 random 64-bit keys per pass.
- **kv** looks up ~20-byte string keys in a shared map of 1,048,576 entries,
  in batches of 4,096, with a per-worker xorshift key stream. The map is far
  larger than the CPU caches.
- **alloc** builds, walks and drops a binary tree of 131,071 heap nodes per
  pass. One worker still shares the machine with the concurrent garbage
  collector, as a service in a managed runtime does.
- **tls** completes full TLS 1.3 handshakes — X25519 key exchange, ECDSA
  P-256 certificate, no session resumption — between a client and a server on
  the same machine over an in-memory pipe.

**http** serves 1,024-byte responses over loopback TCP and requests them from
two keep-alive connections per usable CPU for four seconds. Client and server
share the machine. Unlike the other tests it crosses the kernel on every
request, so it also reflects the platform's network stack and scheduler.

Every kernel checks its own output: the first decompressed block is compared
byte for byte, the first decoded document is compared field by field, every
lookup result is checked, handshakes must be full TLS 1.3. A wrong answer
fails the result; partial samples do not produce metrics.

## Inputs are pinned

The text corpus and the JSON document are generated from fixed seeds using
integer arithmetic only, so they are bit-identical on every architecture.
(Floating-point library functions are not: their last bit differs between
CPUs.) Their SHA-256 digests are asserted in `internal/tests/workload`:

| Input | SHA-256 |
|---|---|
| 512 KiB text corpus | `b83deb1c1aef35b1810d74ecb39b589097fc11a46060f006d24f59e0ff46fa78` |
| JSON document, encoded | `eee712fd4468c332a12c190cc2fd9673979321751993b808923a8478689aff0b` |

A change to either digest is a change of workload and needs a new protocol.

## The toolchain is part of the method

The kernels are standard-library code, so their speed moves with the Go
release that built the binary. Every report records it as
`environment.go_version`; the dataset validator rejects a cohort that mixes
toolchains. Two cohorts are comparable only when they were built with the same
Go minor release. `--quick` shortens every phase to one second and is never
ranked.

## Cohort contract

A standard cohort follows the compute design: ten independently provisioned
fresh samples, three successful repeats each, one binary. The validator checks
report structure, campaign coordinates and metric definitions across the
cohort. It defines no composite ranking for this category yet; published
cohorts are shown as measured, without an index.
