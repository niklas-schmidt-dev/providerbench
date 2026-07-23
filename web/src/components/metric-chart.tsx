import { MetricBarChart } from "@/components/metric-bar-chart";
import type { Run } from "@/lib/data";
import { getMetricDef } from "@/lib/metrics";
import { metricSeries } from "@/lib/series";

// Server-side wrapper: looks up the metric definition so every chart carries
// its workload description and methodology link — a number is never shown
// without saying what was measured.
export function MetricChart({
  runs,
  test,
  metric,
}: {
  runs: Run[];
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
      sourceHref={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/internal/tests/${def.test}.go`}
      note={def.note}
      data={metricSeries(runs, test, metric)}
    />
  );
}
