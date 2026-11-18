// Server-side shaping: aggregated cohorts -> plain, serializable records the
// client charts and tables consume. Charts never see Run objects or raw JSON.

import type { ScoredGroup } from "@/lib/aggregate";
import type { CompanySlug } from "@/lib/companies";
import { getProvider } from "@/lib/providers";

export type MetricStat = {
  p50: number;
  p10: number;
  p90: number;
  p99: number;
  mean: number;
  unit: string;
  higherIsBetter: boolean;
};

export type PlanDatum = {
  /** Cohort id: provider + plan + region + campaign. */
  id: string;
  provider: string;
  providerName: string;
  company?: CompanySlug;
  plan: string;
  product?: string;
  tier?: string;
  region?: string;
  priceMonth?: number;
  priceHour?: number;
  score: number;
  value?: number;
  rankEligible: boolean;
  eligibilityReasons: string[];
  hostCount: number;
  runCount: number;
  cores: number;
  memoryGb?: number;
  cpuModel?: string;
  cohortId: string;
  protocol: string;
  profile: string;
  measuredFrom: string;
  measuredTo: string;
  rawFiles: string[];
  /** Keyed `${test}.${metric}`. */
  metrics: Record<string, MetricStat>;
};

export function metricKey(test: string, metric: string): string {
  return `${test}.${metric}`;
}

export function toPlanDatum(group: ScoredGroup): PlanDatum {
  const providerSlug = group.provider.name ?? "unknown";
  const provider = getProvider(providerSlug);
  const metrics: Record<string, MetricStat> = {};
  for (const result of group.results) {
    for (const metric of result.metrics) {
      const d = metric.distribution;
      metrics[metricKey(result.test, metric.name)] = {
        p50: d.p50,
        p10: d.p10,
        p90: d.p90,
        p99: d.p99,
        mean: d.mean,
        unit: metric.unit,
        higherIsBetter: metric.higherIsBetter,
      };
    }
  }
  return {
    id: group.id,
    provider: providerSlug,
    providerName: provider.name,
    company: provider.company,
    plan: group.provider.plan ?? group.provider.product ?? providerSlug,
    product: group.provider.product,
    tier: group.provider.tier,
    region: group.provider.region,
    priceMonth: group.provider.price_eur_month,
    priceHour: group.provider.price_eur_hour,
    score: group.performanceScore,
    value: group.valueIndex,
    rankEligible: group.rankEligible,
    eligibilityReasons: group.eligibilityReasons,
    hostCount: group.hostCount,
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
    rawFiles: group.runs.map((run) => `${run.slug}.json`),
    metrics,
  };
}

/** Stable order: provider registry order, then price, then plan name. */
export function sortPlans(plans: PlanDatum[], providerOrder: string[]): PlanDatum[] {
  const rank = (slug: string) => {
    const i = providerOrder.indexOf(slug);
    return i === -1 ? providerOrder.length : i;
  };
  return [...plans].sort(
    (a, b) =>
      rank(a.provider) - rank(b.provider) ||
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

export function sourceUrl(category: string, test: string): string {
  return `https://github.com/niklas-schmidt-dev/providerbench/blob/main/internal/tests/${category}/${test}.go`;
}
