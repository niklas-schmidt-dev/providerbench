import { SectionHeading } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export function LocationComparison({ groups }: { groups: ScoredGroup[] }) {
  const byPlan = new Map<string, ScoredGroup[]>();
  for (const group of groups) {
    const plan = group.provider.plan;
    const region = group.provider.region;
    if (!plan || !region) continue;
    byPlan.set(plan, [...(byPlan.get(plan) ?? []), group]);
  }
  const comparisons = [...byPlan.entries()].filter(
    ([, planGroups]) => new Set(planGroups.map((group) => group.provider.region)).size > 1,
  );
  if (comparisons.length === 0) return null;

  return (
    <section className="mt-14">
      <SectionHeading
        title="Location comparison"
        description="Same provider and plan, fresh hosts in each region. Location results never mix into the global table: only the strongest region median for each plan represents the provider there."
      />

      <div className="mt-5 space-y-5">
        {comparisons.map(([plan, planGroups]) => (
          <div key={plan} className="overflow-x-auto rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{plan}</span>
                <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                  {planGroups.length} regions
                </Badge>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                values are P50 · tails shown inline
              </span>
            </div>
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Hosts</TableHead>
                  <TableHead className="text-right">Perf. index</TableHead>
                  <TableHead className="text-right">CPU 1-core</TableHead>
                  <TableHead className="text-right">CPU all-core</TableHead>
                  <TableHead className="text-right">4K read</TableHead>
                  <TableHead className="text-right">Network latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...planGroups]
                  .sort((a, b) => b.performanceScore - a.performanceScore)
                  .map((group, index) => (
                    <TableRow key={group.id}>
                      <TableCell>
                        <span className="block font-mono text-xs">
                          {group.provider.region}
                        </span>
                        {index === 0 && (
                          <Badge
                            variant="secondary"
                            className="ml-2 h-4 px-1 text-[9px] text-success"
                          >
                            best median
                          </Badge>
                        )}
                        <span className="mt-1 block font-mono text-[9px] text-muted-foreground">
                          {formatMeasurementWindow(
                            group.measuredFrom,
                            group.measuredTo,
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {group.hostCount}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {group.performanceScore.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {compactMetric(group, "cpu", "single_core_hash")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {compactMetric(group, "cpu", "multi_core_hash")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {compactMetric(group, "disk", "rand_read_4k")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {compactMetric(group, "network", "latency_p50", true)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </section>
  );
}
