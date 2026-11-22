"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChartPanel } from "@/components/charts/chart-panel";
import { GroupedBars, type BarAccessor } from "@/components/charts/grouped-bars";
import { PricePerformanceChart } from "@/components/charts/price-performance-chart";
import { BoardTable } from "@/components/dashboard/board-table";
import { MatrixPanel } from "@/components/dashboard/matrix-panel";
import { MethodSection } from "@/components/dashboard/method-section";
import { OutcomesPanel } from "@/components/dashboard/outcomes-panel";
import { isVisible, PlanSidebar, type PlanFilters } from "@/components/dashboard/plan-sidebar";
import { SuitePanel } from "@/components/dashboard/suite-panel";
import { ViewTabs, type View } from "@/components/dashboard/view-tabs";
import type { DashboardData } from "@/lib/dashboard-data";
import { RAW_DATA_URL } from "@/lib/plans";
import { capitalize } from "@/lib/text";

const EMPTY_FILTERS: PlanFilters = {
  hidden: new Set(),
  excludedTiers: new Set(),
  showProvisional: true,
  query: "",
};

const VALUE: BarAccessor = {
  value: (plan) => plan.value,
  higherIsBetter: true,
  unit: "index",
  format: (v) => String(Math.round(v)),
};

/**
 * One category's dashboard. The sections come from the data: a test becomes
 * a bar chart or a matrix, item outcomes get their own view, and the price
 * and composite views appear where the category has prices and a ranking.
 */
export function Dashboard({ data }: { data: DashboardData }) {
  const { meta, plans, stats, sections, scored, priced, yOptions } = data;
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

  const scatter = priced && yOptions.length > 0;
  const views = useMemo<View[]>(
    () => [
      ...(scatter ? [{ id: "price-performance", label: scored ? "Price vs performance" : "Price" }] : []),
      ...(scored && priced ? [{ id: "value", label: "Value" }] : []),
      ...sections.map((section) => ({ id: section.id, label: section.tab })),
      { id: "board", label: "Board" },
      { id: "method", label: "Method" },
    ],
    [sections, scatter, scored, priced],
  );

  const many = capitalize(meta.noun.many);
  const figures: Array<[string, string | number]> = [
    ["Providers", stats.providers],
    [many, stats.plans],
    ...(stats.freshHosts > 0 ? ([["Fresh hosts", stats.freshHosts]] as Array<[string, number]>) : []),
    ["Raw runs", stats.runs],
    ["Updated", stats.updated],
  ];

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_var(--sidebar-width)]">
      <main id="main" className="min-w-0" inert={plansOpen || undefined}>
        <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
          <p className="text-[12px] text-subtle">{[meta.name, meta.tagline].filter(Boolean).join(" · ")}</p>
          <h1 className="mt-1.5 text-[28px] leading-[34px] font-medium tracking-[-0.03em] text-balance sm:text-[32px] sm:leading-[38px]">
            {meta.headline ?? `${meta.name} benchmarks`}
          </h1>
          <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
            {meta.lead ?? meta.description}
          </p>
          <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
            {figures.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-[12px] text-subtle">{label}</dt>
                <dd className="text-[20px] leading-7 font-medium tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
          {data.sample && (
            <p className="mt-5 text-[13px] text-muted-foreground">
              Sample data: these numbers illustrate the layout and are not measurements.
            </p>
          )}
        </header>

        <ViewTabs
          views={views}
          onOpenPlans={() => setPlansOpen(true)}
          planSummary={`${many} ${visible.length}/${plans.length}`}
        />

        {scatter && (
          <PricePerformanceChart
            id="price-performance"
            plans={visible}
            yOptions={yOptions}
            noun={meta.noun.one}
            description={
              scored
                ? "What each euro of monthly price buys. Up and to the left is better; plans on the Pareto line are beaten by nothing on both axes."
                : `Monthly price against any metric the reports hold. The Pareto line joins the ${meta.noun.many} that nothing beats on both price and the chosen metric.`
            }
          />
        )}

        {scored && priced && (
          <ChartPanel
            id="value"
            title="Work per euro"
            description="Composite performance per euro of monthly price, normalized so the best-value plan is 100."
            footer="Neither the price column nor the score column answers the question alone. This index is the combination: measured composite work divided by monthly price."
          >
            <GroupedBars plans={visible} accessor={VALUE} label="Value index per plan" />
          </ChartPanel>
        )}

        {sections.map((section) =>
          section.kind === "suite" ? (
            <SuitePanel key={section.id} section={section} plans={visible} noun={meta.noun.one} />
          ) : section.kind === "matrix" ? (
            <MatrixPanel key={section.id} section={section} plans={visible} noun={meta.noun} />
          ) : (
            <OutcomesPanel key={section.id} section={section} plans={visible} noun={meta.noun} />
          ),
        )}

        <section id="board" aria-labelledby="board-title" className="border-b border-border py-6 sm:py-7">
          <div className="flex flex-col gap-0.5 px-4 sm:px-7">
            <h2 id="board-title" className="text-base font-medium tracking-tight">
              The board
            </h2>
            <p className="max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
              {scored
                ? "Every plan in the current selection, ranked by composite cross-host P50 in its best-measured region. The best cell per column is set in ink."
                : `Every ${meta.noun.one} in the current selection with every metric its reports hold. Nothing is ranked: sort by the column you care about. The best cell per column is set in ink.`}
            </p>
          </div>
          <div className="mt-5">
            <BoardTable
              plans={visible}
              columns={data.boardColumns}
              scored={scored}
              priced={priced}
              measuresMachine={meta.measuresMachine}
              noun={meta.noun}
            />
          </div>
        </section>

        <MethodSection id="method" method={data.method} scored={scored} />
      </main>

      <PlanSidebar
        plans={plans}
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        open={plansOpen}
        onClose={closePlans}
        noun={meta.noun}
        footer={
          <>
            {stats.freshHosts > 0
              ? `${stats.runs} raw runs from ${stats.freshHosts} fresh hosts.`
              : `${stats.runs} raw ${stats.runs === 1 ? "report" : "reports"}.`}{" "}
            <a href={RAW_DATA_URL} className="text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground">
              Download the dataset
            </a>
          </>
        }
      />
    </div>
  );
}
