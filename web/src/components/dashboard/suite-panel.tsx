"use client";

import { useEffect, useMemo, useState } from "react";

import { ChartPanel, Segmented } from "@/components/charts/chart-panel";
import { GroupedBars, type BarAccessor } from "@/components/charts/grouped-bars";
import type { MetricDef } from "@/lib/metrics";
import { metricKey, sourceUrl, type PlanDatum } from "@/lib/plans";

export function metricAnchor(def: Pick<MetricDef, "test" | "metric">): string {
  return `${def.test}-${def.metric}`;
}

function shortLabel(def: MetricDef): string {
  const tail = def.title.split(" · ")[1] ?? def.title;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** One benchmark suite: a metric switch above one grouped bar chart. */
export function SuitePanel({
  id,
  title,
  summary,
  metrics,
  plans,
  defaultMetric,
}: {
  id: string;
  title: string;
  summary?: string;
  metrics: MetricDef[];
  plans: PlanDatum[];
  defaultMetric?: string;
}) {
  const [selected, setSelected] = useState(defaultMetric ?? metrics[0]?.metric ?? "");
  const def = metrics.find((m) => m.metric === selected) ?? metrics[0];

  // Deep links (#cpu-single_core_hash, e.g. from ⌘K) select their metric.
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      const match = metrics.find((m) => metricAnchor(m) === hash);
      if (match) setSelected(match.metric);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [metrics]);

  const accessor = useMemo<BarAccessor>(() => {
    const key = metricKey(def.test, def.metric);
    return {
      value: (plan) => plan.metrics[key]?.p50,
      range: (plan) => {
        const stat = plan.metrics[key];
        return stat && stat.p90 !== stat.p10 ? [stat.p10, stat.p90] : undefined;
      },
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
    };
  }, [def]);

  if (!def) return null;

  return (
    <ChartPanel
      id={id}
      anchors={metrics.map(metricAnchor)}
      title={title}
      description={summary}
      controls={
        metrics.length > 1 ? (
          <Segmented
            label={`${title} metric`}
            value={def.metric}
            onChange={setSelected}
            options={metrics.map((m) => ({ value: m.metric, label: shortLabel(m) }))}
          />
        ) : undefined
      }
      footer={
        <>
          <span className="text-muted-foreground">{def.title}.</span> {def.workload}
          {def.note ? ` ${def.note}` : ""} Bars are the cross-host P50; whiskers span P10–P90.{" "}
          <a
            href={sourceUrl(def.category, def.test)}
            className="text-muted-foreground underline decoration-border-strong underline-offset-3 transition-colors hover:text-foreground"
          >
            Benchmark source
          </a>
        </>
      }
    >
      <GroupedBars plans={plans} accessor={accessor} label={`${def.title} per plan`} />
    </ChartPanel>
  );
}
