import { describe, expect, test } from "bun:test";

import {
  aggregateRuns,
  currentScoredGroups,
  latestMeasurementGroups,
  scoreGroups,
} from "@/lib/aggregate";

// The full scoring suite. `factor` scales quality in one direction: for
// lower-is-better metrics the emitted value is inverted so a higher factor
// is better everywhere and every cross-cohort ratio equals factorA/factorB.
const SUITE = [
  { test: "cpu", name: "single_core_hash", unit: "MB/s", higher: true },
  { test: "cpu", name: "multi_core_hash", unit: "MB/s", higher: true },
  { test: "memory", name: "copy_bandwidth", unit: "GB/s", higher: true },
  { test: "memory", name: "random_access_latency", unit: "ns", higher: false },
  { test: "disk", name: "seq_write", unit: "MB/s", higher: true },
  { test: "disk", name: "seq_read", unit: "MB/s", higher: true },
  { test: "disk", name: "rand_read_4k", unit: "IOPS", higher: true },
  { test: "disk", name: "fsync_latency_p50", unit: "ms", higher: false },
  { test: "network", name: "latency_p50", unit: "ms", higher: false },
  { test: "network", name: "download", unit: "Mbps", higher: true },
  { test: "network", name: "upload", unit: "Mbps", higher: true },
  { test: "steal", name: "consistency_cv", unit: "%", higher: false },
  { test: "steal", name: "p99_over_p50", unit: "ratio", higher: false },
];

function observation({
  campaign,
  index,
  createdAt,
  value,
  repeat = 1,
  quick = false,
  omitSampleIndex = false,
  onlyTests,
  notes,
  rankEligible = false,
  eligibilityReasons = [],
  protocol = "compute-cli-test",
}) {
  const byTest = new Map();
  for (const metric of SUITE) {
    if (onlyTests && !onlyTests.includes(metric.test)) continue;
    const metrics = byTest.get(metric.test) ?? [];
    metrics.push({
      name: metric.name,
      value: metric.higher ? value : 10000 / value,
      unit: metric.unit,
      higher_is_better: metric.higher,
    });
    byTest.set(metric.test, metrics);
  }
  const measurement = {
    campaign_id: campaign,
    fresh_instance: true,
  };
  if (!omitSampleIndex) {
    measurement.sample_index = index;
    measurement.repeat_index = repeat;
  }
  return {
    slug: `${campaign}-${index}-${repeat}`,
    schema_version: 1,
    cli_version: "test",
    category: "compute",
    created_at: createdAt,
    manifest: {
      file: `${campaign}-${index}-${repeat}.json`,
      sha256: "test",
      schema_version: 1,
      protocol_version: protocol,
      profile: "standard",
      category: "compute",
      cohort_id: campaign,
      rank_eligible: rankEligible,
      eligibility_reasons: eligibilityReasons,
    },
    quick: quick || undefined,
    provider: {
      name: "provider",
      product: "vps",
      plan: "two-core",
      region: "eu-1",
    },
    measurement,
    system: {
      os: "linux",
      arch: "amd64",
      cpu_cores: 2,
    },
    results: [...byTest.entries()].map(([testName, metrics]) => ({
      test: testName,
      started_at: createdAt,
      duration_seconds: 3,
      metrics,
      notes,
    })),
  };
}

function campaign(id, day, hostCount, value, extra = {}) {
  const rankEligible =
    extra.rankEligible ??
    (hostCount >= 10 && !extra.quick && !extra.onlyTests && !extra.omitSampleIndex);
  return Array.from({ length: hostCount }, (_, index) =>
    observation({
      campaign: id,
      index: index + 1,
      createdAt: `2026-07-${String(day).padStart(2, "0")}T08:${String(
        index,
      ).padStart(2, "0")}:00.000Z`,
      value,
      rankEligible,
      eligibilityReasons: rankEligible ? [] : ["fixture is provisional"],
      ...extra,
    }),
  );
}

function asProvider(runs, name) {
  return runs.map((run) => ({
    ...run,
    slug: `${name}-${run.slug}`,
    provider: { ...run.provider, name },
  }));
}

describe("dated benchmark cohorts", () => {
  test("keeps campaigns separate instead of averaging history together", () => {
    const groups = aggregateRuns([
      ...campaign("provider-2026q2", 1, 10, 100),
      ...campaign("provider-2026q3", 24, 10, 140),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.cohortId).sort()).toEqual([
      "provider-2026q2",
      "provider-2026q3",
    ]);
    expect(groups.map((group) => group.hostCount)).toEqual([10, 10]);
    expect(groups[0].results[0].measuredTo).toMatch(/03\.000Z$/);
  });

  test("headlines keep the latest complete cohort during an active campaign", () => {
    const complete = campaign("provider-2026q2", 1, 10, 100);
    const active = campaign("provider-2026q3", 24, 1, 140);
    const partialGroups = aggregateRuns([...complete, ...active]);

    expect(latestMeasurementGroups(partialGroups)[0].cohortId).toBe(
      "provider-2026q2",
    );

    const completeGroups = aggregateRuns([
      ...complete,
      ...campaign("provider-2026q3", 24, 10, 140),
    ]);
    expect(latestMeasurementGroups(completeGroups)[0].cohortId).toBe(
      "provider-2026q3",
    );
  });

  test("historical outliers do not renormalize current performance scores", () => {
    const currentPeer = asProvider(campaign("peer-2026q3", 24, 10, 200), "peer");
    const current = currentScoredGroups(
      aggregateRuns([
        ...campaign("provider-2026q2", 1, 10, 1000),
        ...campaign("provider-2026q3", 24, 10, 100),
        ...currentPeer,
      ]),
    );

    expect(
      current.find((group) => group.provider.name === "provider")
        ?.performanceScore,
    ).toBeCloseTo(50);
    expect(
      current.find((group) => group.provider.name === "peer")
        ?.performanceScore,
    ).toBeCloseTo(100);
  });

  test("quick cohorts never rank and never supersede full campaigns", () => {
    const groups = aggregateRuns([
      ...campaign("provider-2026q2", 1, 10, 100),
      ...campaign("provider-2026q3-quick", 24, 10, 140, { quick: true }),
    ]);

    const quickGroup = groups.find(
      (group) => group.cohortId === "provider-2026q3-quick",
    );
    expect(quickGroup?.quick).toBe(true);
    expect(quickGroup?.rankEligible).toBe(false);
    expect(latestMeasurementGroups(groups)[0].cohortId).toBe("provider-2026q2");
  });

  test("campaign runs without a sample index collapse into one host", () => {
    const groups = aggregateRuns(
      Array.from({ length: 10 }, (_, index) =>
        observation({
          campaign: "provider-2026q3",
          index: index + 1,
          createdAt: `2026-07-24T08:${String(index).padStart(2, "0")}:00.000Z`,
          value: 100,
          omitSampleIndex: true,
        }),
      ),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].hostCount).toBe(1);
    expect(groups[0].rankEligible).toBe(false);
  });

  test("a partial test suite cannot earn a ranked composite", () => {
    const groups = aggregateRuns(
      campaign("provider-2026q3", 24, 10, 100, { onlyTests: ["cpu"] }),
    );

    expect(groups[0].hostCount).toBe(10);
    expect(groups[0].rankEligible).toBe(false);
    expect(scoreGroups(groups)[0].performanceScore).toBe(0);
  });

  test("retains valid failure reports for audit without ranking or scoring them", () => {
    const failed = observation({
      campaign: "provider-failed",
      index: 1,
      createdAt: "2026-07-24T08:00:00.000Z",
      value: 100,
      rankEligible: false,
      eligibilityReasons: ["cohort contains benchmark errors"],
      protocol: "compute-v2",
    });
    failed.schema_version = 2;
    failed.results = [
      {
        test: "disk",
        started_at: failed.created_at,
        duration_seconds: 1,
        metrics: [],
        error: "fsync failed",
      },
    ];

    const groups = aggregateRuns([failed]);
    expect(groups).toHaveLength(1);
    expect(groups[0].runs[0].results[0].error).toBe("fsync failed");
    expect(groups[0].rankEligible).toBe(false);
    expect(scoreGroups(groups)[0].performanceScore).toBe(0);
  });

  test("provisional cohorts do not define the ranked scale", () => {
    const luckyProvisional = asProvider(
      campaign("lucky-2026q3", 24, 2, 400),
      "lucky",
    );
    const current = currentScoredGroups(
      aggregateRuns([...campaign("provider-2026q3", 24, 10, 100), ...luckyProvisional]),
    );

    const ranked = current.find((group) => group.provider.name === "provider");
    expect(ranked?.rankEligible).toBe(true);
    expect(ranked?.performanceScore).toBeCloseTo(100);
  });

  test("workload caveats survive aggregation", () => {
    const groups = aggregateRuns(
      campaign("provider-2026q3", 24, 10, 100, {
        notes: ["page cache could not be bypassed on this platform"],
      }),
    );

    const disk = groups[0].results.find((result) => result.test === "disk");
    expect(disk?.notes).toEqual([
      "page cache could not be bypassed on this platform",
    ]);
  });

  test("keeps protocol versions in separate history series", () => {
    const groups = aggregateRuns([
      ...campaign("provider-legacy", 1, 10, 100, {
        protocol: "compute-cli-0.1.0-dev",
      }),
      ...campaign("provider-v2", 24, 10, 140, {
        protocol: "compute-v2",
      }),
    ]);

    expect(new Set(groups.map((group) => group.seriesId)).size).toBe(2);
    expect(latestMeasurementGroups(groups)).toHaveLength(1);
    expect(latestMeasurementGroups(groups)[0].protocolVersion).toBe("compute-v2");
  });
});
