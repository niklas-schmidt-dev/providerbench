import { metricSummary, type BenchmarkGroup, type Distribution } from "@/lib/aggregate";
import { providerLabel } from "@/lib/providers";

// One bar = one aggregated plan/region. The headline is the cross-host median;
// the full distribution stays attached for tails and tooltips.
export type BarDatum = {
  id: string;
  provider: string; // company slug — chart color follows this entity
  label: string; // provider name, plus plan when needed to disambiguate
  product?: string;
  plan?: string;
  region?: string;
  value: number;
  sample?: boolean;
  rankEligible: boolean;
  hostCount: number;
  cohortId: string;
  measuredFrom: string;
  measuredTo: string;
  distribution: Distribution;
};

export function metricSeries(
  groups: BenchmarkGroup[],
  test: string,
  metric: string,
): BarDatum[] {
  const perProvider = new Map<string, number>();
  for (const group of groups) {
    if (group.provider.name) {
      perProvider.set(
        group.provider.name,
        (perProvider.get(group.provider.name) ?? 0) + 1,
      );
    }
  }
  return groups.flatMap((group) => {
    const summary = metricSummary(group, test, metric);
    const name = group.provider.name;
    if (!summary || !name) return [];
    const ambiguous = (perProvider.get(name) ?? 0) > 1;
    return [
      {
        id: group.id,
        provider: name,
        label:
          ambiguous && group.provider.plan
            ? `${providerLabel(name)} ${group.provider.plan}`
            : providerLabel(name),
        product: group.provider.product,
        plan: group.provider.plan,
        region: group.provider.region,
        value: summary.distribution.p50,
        sample: group.sample,
        rankEligible: group.rankEligible,
        hostCount: group.hostCount,
        cohortId: group.cohortId,
        measuredFrom: group.measuredFrom,
        measuredTo: group.measuredTo,
        distribution: summary.distribution,
      },
    ];
  });
}
