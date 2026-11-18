# Legacy compute protocols

Status: immutable legacy view  
Schema: `schema_version: 1`

Reports created before the strict v2 contract keep their original schema and
protocol identity derived from their recorded CLI version. They remain
validatable and visible as legacy data, but are never aggregated with
`compute-v2` or with another legacy protocol identity.

Legacy ranking retains the historical minimum of ten independent samples and
requires complete score coverage per host. No legacy raw report is migrated or
rewritten.

