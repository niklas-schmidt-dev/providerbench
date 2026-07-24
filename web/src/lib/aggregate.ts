import type { Metric, Run } from "@/lib/data";

export const MIN_RANKED_HOSTS = 10;
export const P99_RECOMMENDED_HOSTS = 100;

export type Distribution = {
  count: number;
  mean: number;
  min: number;
  p10: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
};

export type MetricSummary = {
  name: string;
  unit: string;
  higherIsBetter: boolean;
  distribution: Distribution;
};

export type TestSummary = {
  test: string;
  measuredFrom: string;
  measuredTo: string;
  metrics: MetricSummary[];
  // Union of the raw runs' caveats (cache bypass unavailable, edge colo, ...).
  // These qualify the numbers and must survive aggregation.
  notes: string[];
};

export type BenchmarkGroup = {
  id: string;
  seriesId: string;
  cohortId: string;
  measuredFrom: string;
  measuredTo: string;
  category: string;
  provider: Run["provider"];
  system: Run["system"];
  environment?: Run["environment"];
  representative: Run;
  runs: Run[];
  results: TestSummary[];
  runCount: number;
  hostCount: number;
  freshHostCount: number;
  sample: boolean;
  quick: boolean;
  rankEligible: boolean;
};

export type ScoredGroup = BenchmarkGroup & {
  performanceScore: number;
  valueIndex?: number;
};

type ScoreMetric = {
  test: string;
  metric: string;
  weight: number;
};

// The index is deliberately broad: it rewards useful machine performance,
// not one benchmark that happens to flatter a particular CPU or storage stack.
export const SCORE_METRICS: ScoreMetric[] = [
  { test: "cpu", metric: "single_core_hash", weight: 0.15 },
  { test: "cpu", metric: "multi_core_hash", weight: 0.2 },
  { test: "memory", metric: "copy_bandwidth", weight: 0.1 },
  { test: "memory", metric: "random_access_latency", weight: 0.05 },
  { test: "disk", metric: "seq_write", weight: 0.05 },
  { test: "disk", metric: "seq_read", weight: 0.05 },
  { test: "disk", metric: "rand_read_4k", weight: 0.1 },
  { test: "disk", metric: "fsync_latency_p50", weight: 0.05 },
  { test: "network", metric: "latency_p50", weight: 0.05 },
  { test: "network", metric: "download", weight: 0.05 },
  { test: "network", metric: "upload", weight: 0.05 },
  { test: "steal", metric: "consistency_cv", weight: 0.05 },
  { test: "steal", metric: "p99_over_p50", weight: 0.05 },
];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function summarize(values: number[]): Distribution {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      count: 0,
      mean: Number.NaN,
      min: Number.NaN,
      p10: Number.NaN,
      p50: Number.NaN,
      p90: Number.NaN,
      p99: Number.NaN,
      max: Number.NaN,
    };
  }
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    min: sorted[0],
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max: sorted.at(-1)!,
  };
}

function seriesId(run: Run): string {
  return [
    run.category ?? "compute",
    run.provider.name ?? "unknown",
    run.provider.product ?? "unknown",
    run.provider.plan ?? "unknown",
    run.provider.region ?? "global",
  ]
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
    .join("--");
}

function cohortId(run: Run): string {
  return run.measurement?.campaign_id?.trim() || `run-${run.slug}`;
}

function groupId(series: string, cohort: string): string {
  return `${series}--cohort--${cohort
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

function hostKey(run: Run): string {
  const campaign = run.measurement?.campaign_id;
  const sampleIndex = run.measurement?.sample_index;
  if (campaign && sampleIndex) return `${campaign}:${sampleIndex}`;
  // Campaign runs without a sample index cannot prove they came from
  // different machines. Collapse them into a single host so repeats can
  // never masquerade as independent evidence.
  if (campaign) return `${campaign}:unindexed`;
  return run.slug;
}

function metricKey(test: string, metric: string): string {
  return `${test}.${metric}`;
}

export function aggregateRuns(runs: Run[]): BenchmarkGroup[] {
  const seriesBuckets = new Map<string, Run[]>();
  for (const run of runs) {
    const id = seriesId(run);
    seriesBuckets.set(id, [...(seriesBuckets.get(id) ?? []), run]);
  }

  return [...seriesBuckets.entries()]
    .flatMap(([series, seriesRuns]) => {
      const includedRuns = seriesRuns.filter(
        (run) => !run.measurement?.exclude_from_aggregate,
      );
      const analysisPool = includedRuns.length > 0 ? includedRuns : seriesRuns;
      const cohortBuckets = new Map<string, Run[]>();
      for (const run of analysisPool) {
        const cohort = cohortId(run);
        cohortBuckets.set(cohort, [...(cohortBuckets.get(cohort) ?? []), run]);
      }

      return [...cohortBuckets.entries()].map(([cohort, analysisRuns]) => {
        const id = groupId(series, cohort);
        const excludedOnly = includedRuns.length === 0;
        const representative = [...analysisRuns].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        )[0];
        const hosts = new Map<string, Run[]>();
        for (const run of analysisRuns) {
          const key = hostKey(run);
          hosts.set(key, [...(hosts.get(key) ?? []), run]);
        }

        // Repeated runs on one machine are technical repeats, not independent
        // evidence. Reduce them to one host median before cross-host statistics.
        const perHostMetrics = new Map<string, number[]>();
        const definitions = new Map<string, Metric>();
        for (const hostRuns of hosts.values()) {
          const values = new Map<string, number[]>();
          for (const run of hostRuns) {
            for (const result of run.results) {
              for (const metric of result.metrics) {
                const key = metricKey(result.test, metric.name);
                values.set(key, [...(values.get(key) ?? []), metric.value]);
                definitions.set(key, metric);
              }
            }
          }
          for (const [key, repeats] of values) {
            const hostMedian = summarize(repeats).p50;
            perHostMetrics.set(key, [
              ...(perHostMetrics.get(key) ?? []),
              hostMedian,
            ]);
          }
        }

        const tests = new Map<string, MetricSummary[]>();
        const testWindows = new Map<
          string,
          { starts: number[]; ends: number[] }
        >();
        const testNotes = new Map<string, Set<string>>();
        for (const run of analysisRuns) {
          for (const result of run.results) {
            for (const note of result.notes ?? []) {
              const notes = testNotes.get(result.test) ?? new Set();
              notes.add(note);
              testNotes.set(result.test, notes);
            }
            const startedAt = Date.parse(result.started_at || run.created_at);
            if (!Number.isFinite(startedAt)) continue;
            const window = testWindows.get(result.test) ?? {
              starts: [],
              ends: [],
            };
            window.starts.push(startedAt);
            window.ends.push(
              startedAt + Math.max(0, result.duration_seconds) * 1000,
            );
            testWindows.set(result.test, window);
          }
        }
        for (const [key, values] of perHostMetrics) {
          const [test, ...metricParts] = key.split(".");
          const metricName = metricParts.join(".");
          const definition = definitions.get(key)!;
          tests.set(test, [
            ...(tests.get(test) ?? []),
            {
              name: metricName,
              unit: definition.unit,
              higherIsBetter: definition.higher_is_better,
              distribution: summarize(values),
            },
          ]);
        }

        const freshHostCount = [...hosts.values()].filter((hostRuns) =>
          hostRuns.some((run) => run.measurement?.fresh_instance),
        ).length;
        const sample = analysisRuns.some((run) => run.sample);
        const quick = analysisRuns.some((run) => run.quick);
        const hostCount = hosts.size;
        const runStarts = analysisRuns
          .map((run) => Date.parse(run.created_at))
          .filter(Number.isFinite);
        const testStarts = [...testWindows.values()].flatMap(
          (window) => window.starts,
        );
        const testEnds = [...testWindows.values()].flatMap(
          (window) => window.ends,
        );
        const measuredFrom = new Date(
          Math.min(...(testStarts.length > 0 ? testStarts : runStarts)),
        ).toISOString();
        const measuredTo = new Date(
          Math.max(...(testEnds.length > 0 ? testEnds : runStarts)),
        ).toISOString();

        const results: TestSummary[] = [...tests.entries()]
          .map(([test, metrics]) => {
            const window = testWindows.get(test);
            return {
              test,
              measuredFrom: new Date(
                Math.min(...(window?.starts ?? [Date.parse(measuredFrom)])),
              ).toISOString(),
              measuredTo: new Date(
                Math.max(...(window?.ends ?? [Date.parse(measuredTo)])),
              ).toISOString(),
              metrics: metrics.sort((a, b) => a.name.localeCompare(b.name)),
              notes: [...(testNotes.get(test) ?? [])].sort(),
            };
          })
          .sort((a, b) => a.test.localeCompare(b.test));

        // A partial suite (e.g. `--tests cpu`) must not produce a ranked
        // composite: the geometric mean would silently renormalize onto the
        // metrics the cohort happens to have.
        const fullScoreCoverage = SCORE_METRICS.every((definition) => {
          const summary = results
            .find((result) => result.test === definition.test)
            ?.metrics.find((item) => item.name === definition.metric);
          return (
            summary !== undefined &&
            summary.distribution.count >= MIN_RANKED_HOSTS
          );
        });

        return {
          id,
          seriesId: series,
          cohortId: cohort,
          measuredFrom,
          measuredTo,
          category: representative.category ?? "compute",
          provider: representative.provider,
          system: representative.system,
          environment: representative.environment,
          representative,
          runs: analysisRuns,
          results,
          runCount: analysisRuns.length,
          hostCount,
          freshHostCount,
          sample,
          quick,
          rankEligible:
            !sample &&
            !quick &&
            !excludedOnly &&
            hostCount >= MIN_RANKED_HOSTS &&
            freshHostCount >= MIN_RANKED_HOSTS &&
            fullScoreCoverage,
        } satisfies BenchmarkGroup;
      });
    })
    .sort((a, b) =>
      [
        a.provider.name ?? "",
        a.provider.tier ?? "",
        a.provider.plan ?? "",
        a.provider.region ?? "",
      ]
        .join(":")
        .localeCompare(
          [
            b.provider.name ?? "",
            b.provider.tier ?? "",
            b.provider.plan ?? "",
            b.provider.region ?? "",
          ].join(":"),
        ),
    );
}

// Headline comparisons use the newest complete campaign for each
// provider/product/plan/region. Older campaigns remain available to history
// charts and never get averaged into today's number.
export function latestMeasurementGroups<T extends BenchmarkGroup>(
  groups: T[],
): T[] {
  const bySeries = new Map<string, T[]>();
  for (const group of groups) {
    bySeries.set(group.seriesId, [...(bySeries.get(group.seriesId) ?? []), group]);
  }
  return [...bySeries.values()].map((seriesGroups) => {
    const ranked = seriesGroups.filter((group) => group.rankEligible);
    const candidates = ranked.length > 0 ? ranked : seriesGroups;
    return [...candidates].sort((a, b) =>
      b.measuredTo.localeCompare(a.measuredTo),
    )[0];
  });
}

export function metricSummary(
  group: BenchmarkGroup,
  test: string,
  metric: string,
): MetricSummary | undefined {
  return group.results
    .find((result) => result.test === test)
    ?.metrics.find((item) => item.name === metric);
}

export function scoreGroups(groups: BenchmarkGroup[]): ScoredGroup[] {
  // Only ranked cohorts define the scale. A lucky one-host provisional cohort
  // may be displayed, but it must not become the baseline that deflates every
  // properly measured plan.
  const ranked = groups.filter((group) => group.rankEligible);
  const reference = ranked.length > 0 ? ranked : groups;
  const bestByMetric = new Map<string, number>();
  for (const definition of SCORE_METRICS) {
    const values = reference.flatMap((group) => {
      const value = metricSummary(group, definition.test, definition.metric)?.distribution.p50;
      return value !== undefined && Number.isFinite(value) ? [value] : [];
    });
    if (values.length === 0) continue;
    const sampleMetric = reference
      .map((group) => metricSummary(group, definition.test, definition.metric))
      .find(Boolean);
    bestByMetric.set(
      metricKey(definition.test, definition.metric),
      sampleMetric?.higherIsBetter ? Math.max(...values) : Math.min(...values),
    );
  }

  const rawScores = groups.map((group) => {
    let logSum = 0;
    let usedWeight = 0;
    for (const definition of SCORE_METRICS) {
      const summary = metricSummary(group, definition.test, definition.metric);
      const best = bestByMetric.get(metricKey(definition.test, definition.metric));
      const value = summary?.distribution.p50;
      if (!summary || best === undefined || value === undefined || value <= 0 || best <= 0) {
        continue;
      }
      const ratio = summary.higherIsBetter ? value / best : best / value;
      logSum += definition.weight * Math.log(Math.max(0.000001, Math.min(1, ratio)));
      usedWeight += definition.weight;
    }
    return {
      group,
      raw: usedWeight > 0 ? Math.exp(logSum / usedWeight) : 0,
    };
  });
  const referenceSet = new Set<BenchmarkGroup>(reference);
  const bestRaw = Math.max(
    ...rawScores
      .filter((item) => referenceSet.has(item.group))
      .map((item) => item.raw),
    0,
  );
  const withScores = rawScores.map(({ group, raw }) => ({
    ...group,
    performanceScore: bestRaw > 0 ? (raw / bestRaw) * 100 : 0,
  }));

  const rawValues = withScores.flatMap((group, index) => {
    const price = group.provider.price_eur_month;
    return referenceSet.has(groups[index]) && price && price > 0
      ? [group.performanceScore / price]
      : [];
  });
  const bestValue = Math.max(...rawValues, 0);
  return withScores.map((group) => {
    const price = group.provider.price_eur_month;
    return {
      ...group,
      valueIndex:
        price && price > 0 && bestValue > 0
          ? ((group.performanceScore / price) / bestValue) * 100
          : undefined,
    };
  });
}

// Normalize current price/performance against current cohorts only. Historical
// campaigns remain available to history charts but must not change today's
// 0-100 index after they have been superseded.
export function currentScoredGroups(
  groups: BenchmarkGroup[],
): ScoredGroup[] {
  return scoreGroups(latestMeasurementGroups(groups));
}

export function bestRegionPerPlan(groups: ScoredGroup[]): ScoredGroup[] {
  const best = new Map<string, ScoredGroup>();
  for (const group of groups) {
    const key = [
      group.provider.name,
      group.provider.product,
      group.provider.plan,
    ].join(":");
    const current = best.get(key);
    if (
      !current ||
      (group.rankEligible && !current.rankEligible) ||
      group.rankEligible === current.rankEligible &&
        group.performanceScore > current.performanceScore
    ) {
      best.set(key, group);
    }
  }
  return [...best.values()];
}

export function bestGroupPerProvider(groups: ScoredGroup[]): ScoredGroup[] {
  const best = new Map<string, ScoredGroup>();
  for (const group of groups) {
    const key = group.provider.name ?? group.id;
    const current = best.get(key);
    if (
      !current ||
      (group.rankEligible && !current.rankEligible) ||
      group.rankEligible === current.rankEligible &&
        group.performanceScore > current.performanceScore
    ) {
      best.set(key, group);
    }
  }
  return [...best.values()];
}
