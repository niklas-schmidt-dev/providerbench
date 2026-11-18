import { DsBadge } from "@/components/ds/badge";
import { SectionHead } from "@/components/ds/section-head";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue } from "@/lib/format";

function compactMetric(
  group: ScoredGroup,
  test: string,
  metric: string,
  includeP99 = false,
) {
  const summary = metricSummary(group, test, metric);
  if (!summary) return "—";
  const distribution = summary.distribution;
  // The tail shown is always the bad end: P10 for throughput, P90/P99 for
  // latencies — never the luckiest host.
  if (summary.higherIsBetter) {
    return [
      `P50 ${formatMetricValue(distribution.p50)}`,
      `P10 ${formatMetricValue(distribution.p10)}`,
    ].join(" · ");
  }
  return [
    `P50 ${formatMetricValue(distribution.p50)}`,
    `P90 ${formatMetricValue(distribution.p90)}`,
    ...(includeP99 ? [`P99 ${formatMetricValue(distribution.p99)}`] : []),
  ].join(" · ");
}

const COLUMNS = [
  "Region",
  "Hosts",
  "Score",
  "CPU 1-core",
  "CPU all-core",
  "4K read",
  "Network latency",
];

export function LocationComparison({ groups }: { groups: ScoredGroup[] }) {
  const byPlan = new Map<string, ScoredGroup[]>();
  for (const group of groups) {
    const plan = group.provider.plan;
    const region = group.provider.region;
    if (!plan || !region) continue;
    byPlan.set(plan, [...(byPlan.get(plan) ?? []), group]);
  }
  const comparisons = [...byPlan.entries()].filter(
    ([, planGroups]) =>
      new Set(planGroups.map((group) => group.provider.region)).size > 1,
  );
  if (comparisons.length === 0) return null;

  return (
    <section className="mt-8 grid gap-5">
      <SectionHead
        eyebrow="Coverage"
        title="Location comparison"
        note="Same provider and plan, fresh hosts in each region. Location results never mix into the global table: only the strongest region median for each plan represents the provider there."
      />

      {comparisons.map(([plan, planGroups]) => (
        <div
          key={plan}
          className="overflow-x-auto rounded-md border border-(--border-hairline) bg-card shadow-(--shadow-xs)"
        >
          <div className="flex items-center justify-between border-b border-(--border-hairline) px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[14px] font-medium text-foreground">
                {plan}
              </span>
              <DsBadge tone="neutral">{planGroups.length} regions</DsBadge>
            </div>
            <span className="pb-label text-[10px] text-(--text-faint)">
              values are P50 · tails shown inline
            </span>
          </div>
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr>
                {COLUMNS.map((label, i) => (
                  <th
                    key={label}
                    className="pb-label h-[34px] border-b border-(--border-hairline) px-(--pad-cell-x) whitespace-nowrap text-muted-foreground"
                    style={{ textAlign: i === 0 ? "left" : "right" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...planGroups]
                .sort((a, b) => b.performanceScore - a.performanceScore)
                .map((group, index) => (
                  <tr
                    key={group.id}
                    className="border-b border-(--border-hairline) last:border-b-0"
                  >
                    <td className="px-(--pad-cell-x) py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px] text-foreground">
                          {group.provider.region}
                        </span>
                        {index === 0 && <DsBadge tone="pass">best median</DsBadge>}
                      </span>
                      <span className="mt-1 block font-mono text-[9.5px] text-(--text-faint)">
                        {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
                      </span>
                    </td>
                    <td className="pb-num px-(--pad-cell-x) text-right text-[12.5px] text-foreground">
                      {group.hostCount}
                    </td>
                    <td className="pb-num px-(--pad-cell-x) text-right text-[12.5px] text-foreground">
                      {group.performanceScore.toFixed(1)}
                    </td>
                    {(
                      [
                        ["cpu", "single_core_hash", false],
                        ["cpu", "multi_core_hash", false],
                        ["disk", "rand_read_4k", false],
                        ["network", "latency_p50", true],
                      ] as const
                    ).map(([test, metric, p99]) => (
                      <td
                        key={`${test}.${metric}`}
                        className="pb-num px-(--pad-cell-x) text-right text-[10.5px] whitespace-nowrap text-muted-foreground"
                      >
                        {compactMetric(group, test, metric, p99)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
