import { describe, expect, test } from "bun:test";

import {
  aggregateRuns,
  currentScoredGroups,
  dashboardSubjects,
  isScoredCategory,
  latestMeasurementGroups,
  scoreGroups,
  subjectsOf,
} from "@/lib/aggregate";
import { distinguishPlans, outcomesOf, planTitle, toPlanDatum } from "@/lib/plans";

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

function inCategory(runs, category, profile = "standard") {
  return runs.map((run) => ({
    ...run,
    slug: `${category}-${profile}-${run.slug}`,
    category,
    manifest: { ...run.manifest, category, profile, rank_eligible: false },
  }));
}

function inRegion(runs, region) {
  return runs.map((run) => ({
    ...run,
    slug: `${region}-${run.slug}`,
    provider: { ...run.provider, region },
  }));
}

function withResults(run, results) {
  return {
    ...run,
    results: results.map((result) => ({
      started_at: run.created_at,
      duration_seconds: 1,
      metrics: [],
      ...result,
    })),
  };
}

describe("reports of any category", () => {
  test("a category without a ranking gets no score and leaves the compute scale alone", () => {
    const compute = campaign("provider-2026q3", 24, 10, 100);
    const workload = inCategory(campaign("provider-workload", 24, 10, 100000), "workload");
    const scored = currentScoredGroups(aggregateRuns([...compute, ...workload]));

    expect(scored.find((group) => group.category === "compute")?.performanceScore).toBeCloseTo(100);
    const other = scored.find((group) => group.category === "workload");
    expect(other?.performanceScore).toBeUndefined();
    expect(other?.valueIndex).toBeUndefined();
  });

  test("a sustained cohort never replaces the standard one; both describe the same row", () => {
    const standard = campaign("provider-2026q3", 1, 10, 100);
    const sustained = inCategory(campaign("provider-sustained", 24, 1, 100), "compute", "sustained").map((run) =>
      withResults(run, [
        { test: "cpu_sustained", metrics: [{ name: "retained", value: 97, unit: "%", higher_is_better: true }] },
      ]),
    );
    const current = currentScoredGroups(aggregateRuns([...standard, ...sustained]));

    expect(current.map((group) => group.profile).sort()).toEqual(["standard", "sustained"]);
    expect(current.find((group) => group.profile === "sustained")?.performanceScore).toBeUndefined();

    const subjects = subjectsOf(current);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].primary.profile).toBe("standard");
    const row = toPlanDatum(subjects[0], "var(--provider-other)");
    expect(row.score).toBeCloseTo(100);
    expect(row.metrics["cpu.single_core_hash"].p50).toBe(100);
    expect(row.metrics["cpu_sustained.retained"]).toMatchObject({ p50: 97, hosts: 1, unit: "%" });
    expect(row.quick).toBe(false);

    // A quick sustained cohort marks the row that carries its metrics.
    const quickSustained = sustained.map((run) => ({ ...run, quick: true }));
    const merged = subjectsOf(currentScoredGroups(aggregateRuns([...standard, ...quickSustained])));
    expect(merged).toHaveLength(1);
    expect(merged[0].primary.quick).toBe(false);
    expect(toPlanDatum(merged[0], "var(--provider-other)").quick).toBe(true);
  });

  test("a ranked plan shows once, in its best region; without a ranking every region is a row", () => {
    const fast = inRegion(campaign("provider-fast", 24, 10, 200), "eu-2");
    const slow = campaign("provider-slow", 24, 10, 100);

    const ranked = dashboardSubjects(currentScoredGroups(aggregateRuns([...fast, ...slow])));
    expect(ranked).toHaveLength(1);
    expect(ranked[0].primary.provider.region).toBe("eu-2");

    const open = dashboardSubjects(
      currentScoredGroups(aggregateRuns(inCategory([...fast, ...slow], "workload"))),
    );
    expect(open.map((subject) => subject.primary.provider.region).sort()).toEqual(["eu-1", "eu-2"]);
    expect(toPlanDatum(open[0], "var(--provider-other)").provisional).toBe(false);
  });

  test("where nothing ranks, a quick or a failed cohort still never replaces a complete one", () => {
    const full = inCategory(campaign("reach-2026q2", 1, 1, 100), "reach");
    const quick = inCategory(campaign("reach-2026q3-quick", 24, 1, 50, { quick: true }), "reach");
    const failed = inCategory(campaign("reach-2026q3-failed", 25, 1, 100), "reach").map((run) =>
      withResults(run, [{ test: "regions", error: "no route" }]),
    );
    const latest = (runs) => latestMeasurementGroups(aggregateRuns(runs)).map((group) => group.cohortId);

    expect(latest([...full, ...quick])).toEqual(["reach-2026q2"]);
    expect(latest([...full, ...failed])).toEqual(["reach-2026q2"]);
    // With nothing complete, the newest cohort is still shown rather than nothing.
    expect(latest([...quick])).toEqual(["reach-2026q3-quick"]);
    // And a newer complete cohort does replace the older one.
    expect(latest([...full, ...inCategory(campaign("reach-2026q4", 26, 1, 120), "reach")])).toEqual(["reach-2026q4"]);
  });

  test("a test may have a dot in its name", () => {
    const [run] = inCategory(campaign("odd-2026", 24, 1, 100), "odd");
    const metric = (name) => [{ name, value: 1, unit: "x", higher_is_better: true }];
    const groups = aggregateRuns([
      withResults(run, [
        { test: "tls.handshake", metrics: metric("single_core") },
        { test: "tls.resume", metrics: metric("single.core") },
      ]),
    ]);
    expect(groups[0].results.map((result) => [result.test, result.metrics[0].name])).toEqual([
      ["tls.handshake", "single_core"],
      ["tls.resume", "single.core"],
    ]);
  });

  test("rows that share a plan name are told apart by region or product", () => {
    const here = inCategory(campaign("reach-a", 24, 1, 100), "reach");
    const there = inRegion(inCategory(campaign("reach-b", 24, 1, 100), "reach"), "eu-2");
    const other = asProvider(inCategory(campaign("reach-c", 24, 1, 100), "reach"), "peer");
    const rows = distinguishPlans(
      dashboardSubjects(currentScoredGroups(aggregateRuns([...here, ...there, ...other]))).map((subject) =>
        toPlanDatum(subject, "var(--provider-other)"),
      ),
    );
    expect(rows.map((row) => planTitle(row)).sort()).toEqual([
      "Peer two-core",
      "Provider two-core · eu-1",
      "Provider two-core · eu-2",
    ]);
  });

  test("item outcomes add up per item across the reports of a cohort", () => {
    const [first, second] = inCategory(campaign("quiz-2026", 24, 2, 100), "quiz");
    const metrics = [{ name: "accuracy_en", value: 50, unit: "%", higher_is_better: true }];
    const groups = aggregateRuns([
      withResults(first, [{ test: "sums", metrics, outcomes: { en: "110-" } }]),
      withResults(second, [{ test: "sums", metrics, outcomes: { en: "1001" } }]),
    ]);

    expect(groups[0].results[0].outcomes.en).toEqual({
      solved: [1, 0.5, 0, 0.5],
      unanswered: [0, 0, 0, 0.5],
      reports: 2,
    });
  });

  test("a quick report asks fewer items and does not blur the full ones", () => {
    const [full, quick] = inCategory(campaign("quiz-2026", 24, 2, 100), "quiz");
    const metrics = [{ name: "accuracy_en", value: 50, unit: "%", higher_is_better: true }];
    const groups = aggregateRuns([
      withResults(full, [{ test: "sums", metrics, outcomes: { en: "1100" } }]),
      withResults(quick, [{ test: "sums", metrics, outcomes: { en: "10" } }]),
    ]);

    expect(groups[0].results[0].outcomes.en).toEqual({ solved: [1, 1, 0, 0], unanswered: [0, 0, 0, 0], reports: 1 });
  });

  test("a report may name a category or a test after something every object has", () => {
    expect(isScoredCategory("constructor")).toBe(false);
    const [run] = inCategory(campaign("odd-2026", 24, 1, 100), "constructor");
    const metrics = [{ name: "value", value: 1, unit: "x", higher_is_better: true }];
    const scored = currentScoredGroups(aggregateRuns([withResults(run, [{ test: "toString", metrics }])]));
    expect(scored[0].performanceScore).toBeUndefined();
    const row = toPlanDatum(subjectsOf(scored)[0], "var(--provider-other)");
    expect(row.metrics["toString.value"].p50).toBe(1);
    expect(outcomesOf(row, "toString")).toBeUndefined();
    expect(outcomesOf({ outcomes: {} }, "constructor")).toBeUndefined();
  });

  test("tests and metrics keep the order the reports list them in", () => {
    const [run] = inCategory(campaign("reach-2026", 24, 1, 100), "reach");
    const rtt = (region, value) => ({ name: `rtt_${region}`, value, unit: "ms", higher_is_better: false });
    const groups = aggregateRuns([
      withResults(run, [
        { test: "regions", metrics: [rtt("us_east_1", 90), rtt("eu_west_1", 20), rtt("ap_south_1", 140)] },
        { test: "anchors", metrics: [rtt("b", 2), rtt("a", 1)] },
      ]),
    ]);

    expect(groups[0].results.map((result) => result.test)).toEqual(["regions", "anchors"]);
    expect(groups[0].results[0].metrics.map((metric) => metric.name)).toEqual([
      "rtt_us_east_1",
      "rtt_eu_west_1",
      "rtt_ap_south_1",
    ]);
  });
});
