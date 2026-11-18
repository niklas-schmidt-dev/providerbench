"use client";

import { useMemo, useState } from "react";

import { ChartPanel, Segmented } from "@/components/charts/chart-panel";
import { GroupedBars, type BarAccessor, type BarGrouping } from "@/components/charts/grouped-bars";
import { PricePerformanceChart } from "@/components/charts/price-performance-chart";
import type { PlanDatum } from "@/lib/plans";

const REGION_GROUPING: BarGrouping = {
  key: (plan) => plan.plan,
  caption: (plan) => plan.plan,
  barLabel: (plan) => plan.region ?? "—",
  shadeByPrice: false,
};

const REGION_METRICS = [
  { value: "score", label: "Composite" },
  { value: "cpu.multi_core_hash", label: "CPU all-core" },
  { value: "disk.rand_read_4k", label: "4K read" },
  { value: "network.download", label: "Download" },
] as const;

type RegionMetric = (typeof REGION_METRICS)[number]["value"];

/** A provider's plans against price, and the same plan across its regions. */
export function ProviderCharts({ plans, regions }: { plans: PlanDatum[]; regions: PlanDatum[] }) {
  const [metric, setMetric] = useState<RegionMetric>("score");
  const multiRegion = new Set(regions.map((r) => r.plan)).size < regions.length;

  const accessor = useMemo<BarAccessor>(() => {
    if (metric === "score") {
      return { value: (plan) => plan.score, higherIsBetter: true, unit: "score", format: (v) => v.toFixed(1) };
    }
    return {
      value: (plan) => plan.metrics[metric]?.p50,
      range: (plan) => {
        const stat = plan.metrics[metric];
        return stat ? [stat.p10, stat.p90] : undefined;
      },
      higherIsBetter: true,
      unit: regions.find((r) => r.metrics[metric])?.metrics[metric]?.unit,
    };
  }, [metric, regions]);

  return (
    <>
      <PricePerformanceChart
        id="price-performance"
        plans={plans}
        yOptions={[{ id: "score", label: "Composite score" }]}
        description="Each plan's composite score in its best-measured region, against its monthly price."
      />
      {multiRegion && (
        <ChartPanel
          id="regions"
          title="Same plan, different regions"
          description="The identical plan measured in every region it was benchmarked in. Differences are the datacenter, not the offer."
          controls={
            <Segmented label="Region metric" value={metric} onChange={setMetric} options={REGION_METRICS} />
          }
        >
          <GroupedBars plans={regions} accessor={accessor} grouping={REGION_GROUPING} label="Plans by region" />
        </ChartPanel>
      )}
    </>
  );
}
