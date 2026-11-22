import type { Metric, Run } from "@/lib/data";

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

/** How the items of a test went across the reports of one cohort. */
export type OutcomeSummary = {
  /** Per item, in protocol order: the share of reports that solved it. */
  solved: number[];
  /** Per item: the share of reports with no usable answer. */
  unanswered: number[];
  /** Reports behind each share. */
  reports: number;
};

export type TestSummary = {
  test: string;
  measuredFrom: string;
  measuredTo: string;
  metrics: MetricSummary[];
  // Union of the raw runs' caveats (cache bypass unavailable, edge colo, ...).
  // These qualify the numbers and must survive aggregation.
  notes: string[];
  /** Per variant of the items (a language), for tests that record item outcomes. */
  outcomes?: Record<string, OutcomeSummary>;
};

export type BenchmarkGroup = {
  id: string;
  baseSeriesId: string;
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
  /** A full measurement: full-size workloads, no failed test, some metric. */
  complete: boolean;
  protocolVersion: string;
  profile: string;
  rankEligible: boolean;
  eligibilityReasons: string[];
};

export type ScoredGroup = BenchmarkGroup & {
  /** Absent where no composite is defined: other categories, other profiles. */
  performanceScore?: number;
  valueIndex?: number;
};

type ScoreMetric = {
  test: string;
  metric: string;
  weight: number;
};

const STANDARD_PROFILE = "standard";

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

// A composite exists only where its weights were decided. Every other
// category shows its metrics side by side and ranks nothing.
const SCORE_METRICS_BY_CATEGORY: Record<string, ScoreMetric[]> = {
  compute: SCORE_METRICS,
};

export function isScoredCategory(category: string): boolean {
  // Own keys only: a category is named by a report, and "constructor" is a valid name.
  return Object.hasOwn(SCORE_METRICS_BY_CATEGORY, category);
}

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

function baseSeriesId(run: Run): string {
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

function seriesId(run: Run): string {
  return [
    baseSeriesId(run),
    run.manifest.protocol_version,
    run.manifest.profile,
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

// Reports of one cohort share an item order only when they asked the same
// number of items: a quick report asks a subset. The longest form wins.
function summarizeOutcomes(strings: string[]): OutcomeSummary | undefined {
  const length = Math.max(0, ...strings.map((value) => value.length));
  if (length === 0) return undefined;
  const full = strings.filter((value) => value.length === length);
  const solved = new Array<number>(length).fill(0);
  const unanswered = new Array<number>(length).fill(0);
  for (const value of full) {
    for (let i = 0; i < length; i++) {
      if (value[i] === "1") solved[i]++;
      else if (value[i] === "-") unanswered[i]++;
    }
  }
  return {
    solved: solved.map((count) => count / full.length),
    unanswered: unanswered.map((count) => count / full.length),
    reports: full.length,
  };
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
        const definitions = new Map<string, { test: string; metric: Metric }>();
        for (const hostRuns of hosts.values()) {
          const values = new Map<string, number[]>();
          for (const run of hostRuns) {
            for (const result of run.results) {
              for (const metric of result.metrics) {
                const key = metricKey(result.test, metric.name);
                values.set(key, [...(values.get(key) ?? []), metric.value]);
                definitions.set(key, { test: result.test, metric });
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
        const testOutcomes = new Map<string, Map<string, string[]>>();
        for (const run of analysisRuns) {
          for (const result of run.results) {
            for (const [variant, outcome] of Object.entries(result.outcomes ?? {})) {
              const variants = testOutcomes.get(result.test) ?? new Map<string, string[]>();
              variants.set(variant, [...(variants.get(variant) ?? []), outcome]);
              testOutcomes.set(result.test, variants);
            }
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
          const { test, metric } = definitions.get(key)!;
          tests.set(test, [
            ...(tests.get(test) ?? []),
            {
              name: metric.name,
              unit: metric.unit,
              higherIsBetter: metric.higher_is_better,
              distribution: summarize(values),
            },
          ]);
        }

        const freshHostCount = [...hosts.values()].filter((hostRuns) =>
          hostRuns.some((run) => run.measurement?.fresh_instance),
        ).length;
        const sample = analysisRuns.some((run) => run.sample);
        const quick = analysisRuns.some((run) => run.quick);
        const failed = analysisRuns.some((run) => run.results.some((result) => Boolean(result.error)));
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

        // Tests and metrics keep the order the reports list them in: the
        // order the suite ran and the protocol defines.
        const results: TestSummary[] = [...tests.entries()]
          .map(([test, metrics]) => {
            const window = testWindows.get(test);
            const outcomes = Object.fromEntries(
              [...(testOutcomes.get(test) ?? [])].flatMap(([variant, strings]) => {
                const summary = summarizeOutcomes(strings);
                return summary ? [[variant, summary] as const] : [];
              }),
            );
            return {
              test,
              ...(Object.keys(outcomes).length > 0 ? { outcomes } : {}),
              measuredFrom: new Date(
                Math.min(...(window?.starts ?? [Date.parse(measuredFrom)])),
              ).toISOString(),
              measuredTo: new Date(
                Math.max(...(window?.ends ?? [Date.parse(measuredTo)])),
              ).toISOString(),
              metrics,
              notes: [...(testNotes.get(test) ?? [])].sort(),
            };
          });

        const eligibilityReasons = [
          ...new Set(
            analysisRuns.flatMap(
              (run) => run.manifest.eligibility_reasons ?? [],
            ),
          ),
        ].sort();
        const manifestEligible =
          analysisRuns.length > 0 &&
          analysisRuns.every((run) => run.manifest.rank_eligible);

        return {
          id,
          baseSeriesId: baseSeriesId(representative),
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
          complete: !excludedOnly && !quick && !failed && results.length > 0,
          protocolVersion: representative.manifest.protocol_version,
          profile: representative.manifest.profile,
          rankEligible: !excludedOnly && manifestEligible,
          eligibilityReasons,
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
// provider/product/plan/region and profile. Older campaigns remain available
// to history charts and never get averaged into today's number. Profiles
// measure different things, so a sustained cohort never replaces a standard
// one: each profile keeps its own latest cohort. Where nothing ranks, a
// complete cohort still comes before a quick or a failed one, however new.
export function latestMeasurementGroups<T extends BenchmarkGroup>(
  groups: T[],
): T[] {
  const bySeries = new Map<string, T[]>();
  for (const group of groups) {
    const key = `${group.baseSeriesId}::${group.profile}`;
    bySeries.set(key, [...(bySeries.get(key) ?? []), group]);
  }
  return [...bySeries.values()].map((seriesGroups) => {
    const ranked = seriesGroups.filter((group) => group.rankEligible);
    const complete = seriesGroups.filter((group) => group.complete);
    const candidates = ranked.length > 0 ? ranked : complete.length > 0 ? complete : seriesGroups;
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

// Scores are relative to the best cohort, so they only mean something inside
// one category, and only the standard profile enters the composite.
export function scoreGroups(groups: BenchmarkGroup[]): ScoredGroup[] {
  const scored = new Map<BenchmarkGroup, ScoredGroup>();
  const byCategory = new Map<string, BenchmarkGroup[]>();
  for (const group of groups) {
    if (group.profile !== STANDARD_PROFILE || !isScoredCategory(group.category)) continue;
    byCategory.set(group.category, [...(byCategory.get(group.category) ?? []), group]);
  }
  for (const [category, cohorts] of byCategory) {
    const results = scoreCohorts(cohorts, SCORE_METRICS_BY_CATEGORY[category]);
    cohorts.forEach((cohort, index) => scored.set(cohort, results[index]));
  }
  return groups.map((group) => scored.get(group) ?? { ...group });
}

function scoreCohorts(groups: BenchmarkGroup[], definitions: ScoreMetric[]): ScoredGroup[] {
  // Only ranked cohorts define the scale. A lucky one-host provisional cohort
  // may be displayed, but it must not become the baseline that deflates every
  // properly measured plan.
  const ranked = groups.filter((group) => group.rankEligible);
  const reference = ranked.length > 0 ? ranked : groups;
  const bestByMetric = new Map<string, number>();
  for (const definition of definitions) {
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
    let complete = true;
    for (const definition of definitions) {
      const summary = metricSummary(group, definition.test, definition.metric);
      const best = bestByMetric.get(metricKey(definition.test, definition.metric));
      const value = summary?.distribution.p50;
      if (!summary || best === undefined || value === undefined || value <= 0 || best <= 0) {
        complete = false;
        break;
      }
      const ratio = summary.higherIsBetter ? value / best : best / value;
      logSum += definition.weight * Math.log(Math.max(0.000001, Math.min(1, ratio)));
    }
    return {
      group,
      // Missing metrics invalidate the composite. We deliberately do not
      // renormalize the remaining weights because that would reward partial
      // or failed suites.
      raw: complete ? Math.exp(logSum) : 0,
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

/**
 * One row of a dashboard: a plan in a region, as its standard-profile cohort
 * with the cohorts of its other profiles attached. The profiles answer
 * different questions about the same plan, so they belong on one row.
 */
export type Subject = {
  primary: ScoredGroup;
  others: ScoredGroup[];
};

export function subjectsOf(groups: ScoredGroup[]): Subject[] {
  const bySeries = new Map<string, ScoredGroup[]>();
  for (const group of groups) {
    bySeries.set(group.baseSeriesId, [...(bySeries.get(group.baseSeriesId) ?? []), group]);
  }
  return [...bySeries.values()].map((cohorts) => {
    const primary = cohorts.find((cohort) => cohort.profile === STANDARD_PROFILE) ?? cohorts[0];
    return { primary, others: cohorts.filter((cohort) => cohort !== primary) };
  });
}

function beats(a: ScoredGroup, b: ScoredGroup): boolean {
  if (a.rankEligible !== b.rankEligible) return a.rankEligible;
  return (a.performanceScore ?? -1) > (b.performanceScore ?? -1);
}

function bestBy<T>(items: T[], keyOf: (item: T) => string, groupOf: (item: T) => ScoredGroup): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const current = best.get(key);
    if (!current || beats(groupOf(item), groupOf(current))) best.set(key, item);
  }
  return [...best.values()];
}

function planKey(group: ScoredGroup): string {
  return [group.category, group.provider.name, group.provider.product, group.provider.plan].join(":");
}

/**
 * The rows of a category's dashboard. Where a composite exists, a plan shows
 * once, in its best-measured region. Without one there is no "best", so every
 * measured region is its own row.
 */
export function dashboardSubjects(groups: ScoredGroup[]): Subject[] {
  const subjects = subjectsOf(groups);
  const scored = subjects.filter((subject) => isScoredCategory(subject.primary.category));
  const unscored = subjects.filter((subject) => !isScoredCategory(subject.primary.category));
  return [...bestBy(scored, (subject) => planKey(subject.primary), (subject) => subject.primary), ...unscored];
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
  return bestBy(groups, planKey, (group) => group);
}

export function bestGroupPerProvider(groups: ScoredGroup[]): ScoredGroup[] {
  return bestBy(
    groups,
    (group) => `${group.category}:${group.provider.name ?? group.id}`,
    (group) => group,
  );
}
