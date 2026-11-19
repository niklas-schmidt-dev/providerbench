# Reach protocol `reach-v1`

Status: draft — frozen when the first cohort is published  
Schema: `schema_version: 2`  
Category: `reach`  
Profiles: `standard`

This document fixes the meaning of reports carrying
`protocol_version: "reach-v1"`. Until the first cohort lands in
`data/results/` the method may still be corrected; from then on a change needs
a new protocol identifier and existing reports are never reinterpreted.

## Why this suite exists

The compute suite's network test talks to the nearest Cloudflare edge. That
says how good the last hop out of the datacenter is, and it is nearly the same
for every well-connected provider. It does not say where the machine sits on
the network: how far it is from the regions where its users, its database or
the APIs it calls actually are.

## Standard profile

One test, `regions`, with one metric per anchor:

| Metric | Anchor region | Place |
|---|---|---|
| `rtt_us_east_1` | us-east-1 | N. Virginia |
| `rtt_us_west_2` | us-west-2 | Oregon |
| `rtt_sa_east_1` | sa-east-1 | São Paulo |
| `rtt_eu_west_1` | eu-west-1 | Ireland |
| `rtt_eu_central_1` | eu-central-1 | Frankfurt |
| `rtt_af_south_1` | af-south-1 | Cape Town |
| `rtt_ap_south_1` | ap-south-1 | Mumbai |
| `rtt_ap_southeast_1` | ap-southeast-1 | Singapore |
| `rtt_ap_northeast_1` | ap-northeast-1 | Tokyo |

All metrics are in milliseconds; lower is better.

For each anchor the test resolves `s3.<region>.amazonaws.com` once, opens one
untimed TCP connection on port 443 to settle on an address, then reports the
median of seven timed connections to that same address. A TCP handshake is one
network round trip with no application behind it, so the connect time is the
round-trip time of the path plus the anchor's SYN handling. Name resolution,
TLS and HTTP are not part of it.

An anchor publishes several addresses, and a network can fail to reach one of
them while the region is fine. The untimed connection therefore tries up to
three of the resolved addresses in order and keeps the first that answers.

The anchors are the regional S3 endpoints of the largest public cloud: always
on, present in every region, and answered from inside the region rather than
from an edge network. The numbers are therefore distances to those nine
regions, not to "the internet". The anchor set is part of the protocol:
changing it changes what the metrics mean.

An anchor with no reachable address among those three, or one that stops
answering during the timed connections, fails the result. A partial matrix
would silently change what a cohort's medians cover.

`--quick` takes three samples per anchor and is never ranked.

## What it does not measure

- IPv6 paths. Every connection is IPv4.
- Throughput or packet loss. The compute `network` test covers throughput to
  the nearest edge.
- Latency as an end user experiences it. Anchors sit in datacenters.

## Cohort contract

Round-trip time belongs to a region more than to a plan, so a cohort is
identified by provider, product, plan and region like any other, but the plan
matters little. A standard cohort follows the compute design: ten
independently provisioned fresh samples, three successful repeats each.

The validator checks report structure, campaign coordinates and metric
definitions across the cohort. It defines no composite ranking for this
category: there is no single "best" position on the network, only the right
one for a given set of users.
