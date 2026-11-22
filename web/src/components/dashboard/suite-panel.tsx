"use client";

import { useEffect, useMemo, useState } from "react";

import { ChartPanel, Segmented } from "@/components/charts/chart-panel";
import { GroupedBars, type BarAccessor } from "@/components/charts/grouped-bars";
import { currentHash } from "@/lib/hash";
import type { MetricInfo } from "@/lib/metrics";
import { metricKey, type PlanDatum } from "@/lib/plans";
import type { SuiteSection } from "@/lib/sections";

export function metricAnchor(def: Pick<MetricInfo, "test" | "metric">): string {
  return `${def.test}-${def.metric}`;
}

export const SOURCE_LINK =
  "text-muted-foreground underline decoration-border-strong underline-offset-3 transition-colors hover:text-foreground";

/** One test of a suite: a metric switch above one grouped bar chart. */
export function SuitePanel({
  section,
  plans,
  noun,
}: {
  section: SuiteSection;
  plans: PlanDatum[];
  /** What one bar is: a plan, a model. */
  noun: string;
}) {
  const { metrics } = section;
  const [selected, setSelected] = useState(section.defaultMetric ?? metrics[0]?.metric ?? "");
  const def = metrics.find((m) => m.metric === selected) ?? metrics[0];

  // Deep links (#cpu-single_core_hash, e.g. from ⌘K) select their metric.
  useEffect(() => {
    const sync = () => {
      const hash = currentHash();
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
      hosts: (plan) => plan.metrics[key]?.hosts,
      unit: def.unit,
      higherIsBetter: def.higherIsBetter,
    };
  }, [def]);

  if (!def) return null;

  // A cohort of several hosts has a spread; a single report has one value.
  const key = metricKey(def.test, def.metric);
  const cohorts = plans.some((plan) => (plan.metrics[key]?.hosts ?? 0) > 1);

  return (
    <ChartPanel
      id={section.id}
      anchors={metrics.map(metricAnchor)}
      title={section.title}
      description={section.summary}
      controls={
        metrics.length > 1 ? (
          <Segmented
            label={`${section.title} metric`}
            value={def.metric}
            onChange={setSelected}
            options={metrics.map((m) => ({ value: m.metric, label: m.label }))}
          />
        ) : undefined
      }
      footer={
        <>
          <span className="text-muted-foreground">{def.title}.</span>
          {def.workload ? ` ${def.workload}` : ""}
          {def.note ? ` ${def.note}` : ""}{" "}
          {cohorts
            ? "Bars are the cross-host P50; whiskers span P10–P90."
            : "Bars are the value each report measured."}{" "}
          <a href={section.sourceUrl} className={SOURCE_LINK}>
            Benchmark source
          </a>
        </>
      }
    >
      <GroupedBars plans={plans} accessor={accessor} label={`${def.title} per ${noun}`} />
    </ChartPanel>
  );
}
