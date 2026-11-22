// Server-side shaping: aggregated cohorts -> plain, serializable records the
// client charts and tables consume. Charts never see Run objects or raw JSON.

import { formatEuro } from "@/components/charts/scales";
import { isScoredCategory, type OutcomeSummary, type ScoredGroup, type Subject } from "@/lib/aggregate";
import { isWordmark, type CompanySlug } from "@/lib/companies";
import { getProvider } from "@/lib/providers";

export type MetricStat = {
  p50: number;
  p10: number;
  p90: number;
  p99: number;
  mean: number;
  /** Independent hosts behind the distribution. */
  hosts: number;
  unit: string;
  higherIsBetter: boolean;
};

/**
 * One row of a dashboard. A report calls it a plan; in a category that
 * measures models or endpoints it is that model or endpoint.
 */
export type PlanDatum = {
  /** Cohort id: provider + plan + region + campaign. */
  id: string;
  category: string;
  provider: string;
  providerName: string;
  company?: CompanySlug;
  /** Series color, fixed per provider for the page. */
  color: string;
  plan: string;
  /**
   * The plan as charts name it. It is the plan name, extended by the product
   * or region where two rows of a page would otherwise read the same.
   */
  label: string;
  product?: string;
  tier?: string;
  region?: string;
  priceMonth?: number;
  priceHour?: number;
  /** Composite score, where the category defines one. */
  score?: number;
  value?: number;
  rankEligible: boolean;
  /** Shown but not ranked yet. Only a category with a ranking has such rows. */
  provisional: boolean;
  eligibilityReasons: string[];
  /** Measured with the smaller --quick workloads. */
  quick: boolean;
  hostCount: number;
  freshHostCount: number;
  runCount: number;
  cores: number;
  memoryGb?: number;
  cpuModel?: string;
  cohortId: string;
  protocol: string;
  profile: string;
  measuredFrom: string;
  measuredTo: string;
  /** Keyed `${test}.${metric}`. */
  metrics: Record<string, MetricStat>;
  /** Item outcomes keyed by test, then by variant. */
  outcomes?: Record<string, Record<string, OutcomeSummary>>;
};

export function metricKey(test: string, metric: string): string {
  return `${test}.${metric}`;
}

/**
 * A row's item outcomes for one test. Reports name their tests, so the lookup
 * only ever answers with what a report put there.
 */
export function outcomesOf(
  plan: Pick<PlanDatum, "outcomes">,
  test: string,
): Record<string, OutcomeSummary> | undefined {
  return plan.outcomes && Object.hasOwn(plan.outcomes, test) ? plan.outcomes[test] : undefined;
}

function collectMetrics(group: ScoredGroup, into: PlanDatum): void {
  for (const result of group.results) {
    for (const metric of result.metrics) {
      const key = metricKey(result.test, metric.name);
      if (Object.hasOwn(into.metrics, key)) continue; // the standard profile was read first and wins
      const d = metric.distribution;
      into.metrics[key] = {
        p50: d.p50,
        p10: d.p10,
        p90: d.p90,
        p99: d.p99,
        mean: d.mean,
        hosts: d.count,
        unit: metric.unit,
        higherIsBetter: metric.higherIsBetter,
      };
    }
    if (result.outcomes && !outcomesOf(into, result.test)) {
      into.outcomes = { ...into.outcomes, [result.test]: result.outcomes };
    }
  }
}

export function toPlanDatum(subject: Subject, color: string): PlanDatum {
  const group = subject.primary;
  const providerSlug = group.provider.name ?? "unknown";
  const provider = getProvider(providerSlug);
  const plan: PlanDatum = {
    id: group.id,
    category: group.category,
    provider: providerSlug,
    providerName: provider.name,
    company: provider.company,
    color,
    plan: group.provider.plan ?? group.provider.product ?? providerSlug,
    label: group.provider.plan ?? group.provider.product ?? providerSlug,
    product: group.provider.product,
    tier: group.provider.tier,
    region: group.provider.region,
    priceMonth: group.provider.price_eur_month,
    priceHour: group.provider.price_eur_hour,
    score: group.performanceScore,
    value: group.valueIndex,
    rankEligible: group.rankEligible,
    provisional: isScoredCategory(group.category) && !group.rankEligible,
    eligibilityReasons: group.eligibilityReasons,
    // The row carries every cohort's metrics, so one quick cohort marks it.
    quick: group.quick || subject.others.some((cohort) => cohort.quick),
    hostCount: group.hostCount,
    freshHostCount: group.freshHostCount,
    runCount: group.runCount,
    cores: group.system.cpu_cores,
    memoryGb: group.system.mem_total_mb
      ? Math.round((group.system.mem_total_mb / 1024) * 10) / 10
      : undefined,
    cpuModel: group.system.cpu_model,
    cohortId: group.cohortId,
    protocol: group.protocolVersion,
    profile: group.profile,
    measuredFrom: group.measuredFrom,
    measuredTo: group.measuredTo,
    metrics: {},
  };
  for (const cohort of [group, ...subject.others]) collectMetrics(cohort, plan);
  return plan;
}

/**
 * Monthly price for display. Usage-based plans have no list price: their
 * figure is an estimate at 730 hours of full use, so it carries "≈".
 */
export function priceLabel(plan: Pick<PlanDatum, "priceMonth" | "tier">): string | undefined {
  if (plan.priceMonth === undefined) return undefined;
  return `${plan.tier === "usage-based" ? "≈" : ""}${formatEuro(plan.priceMonth)}`;
}

/** Stable order: provider registry order, then provider name, price and plan name. */
export function sortPlans(plans: PlanDatum[], providerOrder: string[]): PlanDatum[] {
  const rank = (slug: string) => {
    const i = providerOrder.indexOf(slug);
    return i === -1 ? providerOrder.length : i;
  };
  return [...plans].sort(
    (a, b) =>
      rank(a.provider) - rank(b.provider) ||
      a.provider.localeCompare(b.provider) ||
      (a.priceMonth ?? Infinity) - (b.priceMonth ?? Infinity) ||
      a.plan.localeCompare(b.plan) ||
      (a.region ?? "").localeCompare(b.region ?? ""),
  );
}

export const RAW_DATA_URL =
  "https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results";

export function rawReportUrl(file: string): string {
  return `https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${file}`;
}

export const TESTS_SOURCE_URL =
  "https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests";

export const PROTOCOLS_URL =
  "https://github.com/niklas-schmidt-dev/providerbench/tree/main/docs/protocols";

export function protocolUrl(protocol: string): string {
  return `https://github.com/niklas-schmidt-dev/providerbench/blob/main/docs/protocols/${protocol}.md`;
}

/**
 * A row's name beside its provider mark: "Hetzner cx23". Where the mark is a
 * wordmark it already says the provider, so the plan stands alone.
 */
export function planTitle(plan: Pick<PlanDatum, "company" | "providerName" | "label">): string {
  return isWordmark(plan.company) ? plan.label : `${plan.providerName} ${plan.label}`;
}

/**
 * Rows that share a provider and a plan name are told apart by what differs
 * between them: the product, the region. Where every region is its own row,
 * two bars would otherwise both read "cx23".
 */
export function distinguishPlans(plans: PlanDatum[]): PlanDatum[] {
  const sameName = new Map<string, PlanDatum[]>();
  for (const plan of plans) {
    const key = `${plan.provider}\n${plan.plan}`;
    sameName.set(key, [...(sameName.get(key) ?? []), plan]);
  }
  return plans.map((plan) => {
    const twins = sameName.get(`${plan.provider}\n${plan.plan}`)!;
    if (twins.length < 2) return plan;
    const differs = (pick: (twin: PlanDatum) => string | undefined) => new Set(twins.map(pick)).size > 1;
    const parts = [
      plan.plan,
      differs((twin) => twin.product) ? plan.product : undefined,
      differs((twin) => twin.region) ? plan.region : undefined,
    ];
    return { ...plan, label: parts.filter(Boolean).join(" · ") };
  });
}

/** The region as a label; a plan that has no region (a model) reports "global". */
export function regionLabel(plan: Pick<PlanDatum, "region">): string | undefined {
  return plan.region && plan.region !== "global" ? plan.region : undefined;
}
