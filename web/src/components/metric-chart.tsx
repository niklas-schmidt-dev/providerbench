import { MetricBarChart } from "@/components/metric-bar-chart";
import type { BenchmarkGroup } from "@/lib/aggregate";
import { getMetricDef } from "@/lib/metrics";
import { metricSeries } from "@/lib/series";

// Server-side wrapper: looks up the metric definition so every chart carries
// its workload description and source-code link — a number is never shown
// without saying what was measured.
export function MetricChart({
  groups,
  test,
  metric,
}: {
  groups: BenchmarkGroup[];
  test: string;
  metric: string;
}) {
  const def = getMetricDef(test, metric);
  if (!def) throw new Error(`unknown metric ${test}.${metric} — add it to lib/metrics.ts`);
  return (
    <MetricBarChart
      title={def.title}
      unit={def.unit}
      higherIsBetter={def.higherIsBetter}
      description={def.workload}
      sourceHref={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/internal/tests/${def.category}/${def.test}.go`}
      command={`providerbench run -t ${def.test}`}
      anchorId={`${def.test}-${def.metric}`}
      note={def.note}
      data={metricSeries(groups, test, metric)}
    />
  );
}
