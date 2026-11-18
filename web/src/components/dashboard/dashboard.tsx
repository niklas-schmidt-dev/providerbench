"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChartPanel } from "@/components/charts/chart-panel";
import { GroupedBars, type BarAccessor } from "@/components/charts/grouped-bars";
import { PricePerformanceChart, type YAxisOption } from "@/components/charts/price-performance-chart";
import { BoardTable } from "@/components/dashboard/board-table";
import { MethodSection } from "@/components/dashboard/method-section";
import { isVisible, PlanSidebar, type PlanFilters } from "@/components/dashboard/plan-sidebar";
import { SuitePanel } from "@/components/dashboard/suite-panel";
import { ViewTabs, type View } from "@/components/dashboard/view-tabs";
import { METRICS, TEST_SUMMARIES } from "@/lib/metrics";
import { metricKey, RAW_DATA_URL, type PlanDatum } from "@/lib/plans";
import type { MetricRef, ScatterMetricRef } from "@/lib/report";
import { SUITE_LABELS } from "@/lib/scoring";

export type DashboardStats = {
  providers: number;
  plans: number;
  hosts: number;
  runs: number;
  updated: string;
};

const SUITE_ORDER = ["cpu", "memory", "disk", "network", "steal"];
const SUITE_DEFAULT: Record<string, string> = {
  cpu: "multi_core_hash",
  disk: "rand_read_4k",
  network: "download",
  steal: "consistency_cv",
};

const EMPTY_FILTERS: PlanFilters = {
  hidden: new Set(),
  excludedTiers: new Set(),
  showProvisional: true,
  query: "",
};

export function Dashboard({
  categorySlug,
  eyebrow,
  plans,
  stats,
  tableMetrics,
  scatterMetrics,
  sample,
}: {
  categorySlug: string;
  eyebrow: string;
  plans: PlanDatum[];
  stats: DashboardStats;
  tableMetrics: MetricRef[];
  scatterMetrics: ScatterMetricRef[];
  sample: boolean;
}) {
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [plansOpen, setPlansOpen] = useState(false);
  const closePlans = useCallback(() => setPlansOpen(false), []);

  // The drawer only exists below lg; leaving that width closes it so the
  // page behind never stays inert.
  useEffect(() => {
    const desktop = matchMedia("(min-width: 64rem)");
    const onChange = () => desktop.matches && setPlansOpen(false);
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);
  const visible = useMemo(() => plans.filter((plan) => isVisible(plan, filters)), [plans, filters]);

  const suites = useMemo(
    () =>
      SUITE_ORDER.map((test) => ({
        test,
        metrics: METRICS.filter((m) => m.category === categorySlug && m.test === test),
      })).filter((suite) => suite.metrics.length > 0),
    [categorySlug],
  );

  const views = useMemo<View[]>(
    () => [
      { id: "price-performance", label: "Price vs performance" },
      { id: "value", label: "Value" },
      ...suites.map((suite) => ({
        id: suite.test,
        label: suite.test === "steal" ? "Consistency" : SUITE_LABELS[suite.test],
      })),
      { id: "board", label: "Board" },
      { id: "method", label: "Method" },
    ],
    [suites],
  );

  const yOptions: YAxisOption[] = [
    { id: "score", label: "Composite score" },
    ...scatterMetrics.map((ref) => {
      const def = METRICS.find((m) => m.test === ref.test && m.metric === ref.metric);
      return {
        id: ref.id,
        label: ref.shortLabel ?? def?.title ?? ref.metric,
        metric: metricKey(ref.test, ref.metric),
        unit: def?.unit,
      };
    }),
  ];

  const valueAccessor = useMemo<BarAccessor>(
    () => ({
      value: (plan) => plan.value,
      higherIsBetter: true,
      unit: "index",
      format: (v) => String(Math.round(v)),
    }),
    [],
  );

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_var(--sidebar-width)]">
      <main id="main" className="min-w-0" inert={plansOpen || undefined}>
        <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
          <p className="text-[12px] text-subtle">{eyebrow}</p>
          <h1 className="mt-1.5 text-[28px] leading-[34px] font-medium tracking-[-0.03em] text-balance sm:text-[32px] sm:leading-[38px]">
            Measured, not marketed.
          </h1>
          <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
            Every provider sells &ldquo;vCPUs&rdquo; and &ldquo;NVMe&rdquo;. We measure what you actually get: fresh hosts, one
            open harness, every sample published as raw JSON.
          </p>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
            {(
              [
                ["Providers", stats.providers],
                ["Plans", stats.plans],
                ["Fresh hosts", stats.hosts],
                ["Raw runs", stats.runs],
                ["Updated", stats.updated],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-[12px] text-subtle">{label}</dt>
                <dd className="text-[20px] leading-7 font-medium tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
          {sample && (
            <p className="mt-5 text-[13px] text-muted-foreground">
              Sample data: these numbers illustrate the layout and are not measurements.
            </p>
          )}
        </header>

        <ViewTabs
          views={views}
          onOpenPlans={() => setPlansOpen(true)}
          planSummary={`Plans ${visible.length}/${plans.length}`}
        />

        <PricePerformanceChart
          id="price-performance"
          plans={visible}
          yOptions={yOptions}
          description="What each euro of monthly price buys. Up and to the left is better; plans on the Pareto line are beaten by nothing on both axes."
        />

        <ChartPanel
          id="value"
          title="Work per euro"
          description="Composite performance per euro of monthly price, normalized so the best-value plan is 100."
          footer="Neither the price column nor the score column answers the question alone. This index is the combination: measured composite work divided by monthly price."
        >
          <GroupedBars plans={visible} accessor={valueAccessor} label="Value index per plan" />
        </ChartPanel>

        {suites.map((suite) => (
          <SuitePanel
            key={suite.test}
            id={suite.test}
            title={suite.test === "steal" ? "Consistency & steal" : SUITE_LABELS[suite.test]}
            summary={TEST_SUMMARIES[suite.test]}
            metrics={suite.metrics}
            plans={visible}
            defaultMetric={SUITE_DEFAULT[suite.test]}
          />
        ))}

        <section id="board" aria-labelledby="board-title" className="border-b border-border py-6 sm:py-7">
          <div className="flex flex-col gap-0.5 px-4 sm:px-7">
            <h2 id="board-title" className="text-base font-medium tracking-tight">
              The board
            </h2>
            <p className="max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
              Every plan in the current selection, ranked by composite cross-host P50 in its best-measured region. The
              best cell per column is set in ink.
            </p>
          </div>
          <div className="mt-5">
            <BoardTable plans={visible} metricRefs={tableMetrics} />
          </div>
        </section>

        <MethodSection id="method" />
      </main>

      <PlanSidebar
        plans={plans}
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        open={plansOpen}
        onClose={closePlans}
        footer={
          <>
            {stats.runs} raw runs from {stats.hosts} fresh hosts.{" "}
            <a href={RAW_DATA_URL} className="text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground">
              Download the dataset
            </a>
          </>
        }
      />
    </div>
  );
}
