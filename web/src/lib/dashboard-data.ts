import type { YAxisOption } from "@/components/charts/price-performance-chart";
import { aggregateRuns, currentScoredGroups, dashboardSubjects, isScoredCategory } from "@/lib/aggregate";
import { categoryMeta, type CategoryMeta } from "@/lib/categories";
import { anySample, loadCatalog, runsByCategory, type Run } from "@/lib/data";
import { formatMeasurementDate } from "@/lib/dates";
import { distinguishPlans, metricKey, protocolUrl, sortPlans, toPlanDatum, type PlanDatum } from "@/lib/plans";
import { providerColors, PROVIDERS } from "@/lib/providers";
import type { BoardColumn, MetricRef } from "@/lib/report";
import { buildSections, collectTests, type ReportOrder, type Section, type TestInfo } from "@/lib/sections";

/** The part of a category's presentation the client renders. */
export type DashboardMeta = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  noun: { one: string; many: string };
  headline?: string;
  lead?: string;
  measuresMachine: boolean;
};

export type MethodInfo = {
  /** Protocols behind the rows on the page. */
  protocols: string[];
  /** The protocol the CLI pins for the category, which has a document. */
  protocolDoc?: { protocol: string; href: string };
  /** How to run the suite, when the CLI has it. */
  command?: string;
  tests: { name: string; label: string; description?: string; sourceUrl: string }[];
};

export type DashboardStats = {
  providers: number;
  plans: number;
  /** Hosts that were fresh instances; zero where the category has none. */
  freshHosts: number;
  runs: number;
  updated: string;
};

export type DashboardData = {
  meta: DashboardMeta;
  plans: PlanDatum[];
  /** Some numbers on the page are layout samples, not measurements. */
  sample: boolean;
  /** The category has a composite score and a ranking. */
  scored: boolean;
  /** Some row has a monthly price. */
  priced: boolean;
  sections: Section[];
  boardColumns: BoardColumn[];
  /** Y-axes of the price scatter; empty when it has nothing to plot. */
  yOptions: YAxisOption[];
  stats: DashboardStats;
  method: MethodInfo;
};

// The tests and metrics a category's reports hold. Reports list their tests
// in the order they ran and a test's metrics in the order the protocol
// defines them. That order carries meaning (English first, regions west to
// east), so the newest report that has a test sets it.
function reportOrder(runs: Run[]): ReportOrder {
  const tests: string[] = [];
  const metrics = new Map<string, string[]>();
  for (const run of [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    for (const result of run.results) {
      if (!tests.includes(result.test)) tests.push(result.test);
      const names = metrics.get(result.test) ?? [];
      for (const metric of result.metrics) {
        if (!names.includes(metric.name)) names.push(metric.name);
      }
      metrics.set(result.test, names);
    }
  }
  return { tests, metrics };
}

function resolveColumns(refs: MetricRef[], tests: TestInfo[]): BoardColumn[] {
  return refs.flatMap((ref) => {
    const info = tests.find((t) => t.test === ref.test)?.metrics.find((m) => m.metric === ref.metric);
    if (!info) return []; // a curated column nobody reports yet
    return [
      {
        test: ref.test,
        metric: ref.metric,
        label: ref.shortLabel ?? info.title,
        unit: info.unit,
        higherIsBetter: info.higherIsBetter,
        decimals: ref.decimals,
      },
    ];
  });
}

function allColumns(tests: TestInfo[]): BoardColumn[] {
  return tests.flatMap((test) =>
    test.metrics.map((info) => ({
      test: info.test,
      metric: info.metric,
      // One test needs no prefix; with several, the column says whose metric it is.
      label: tests.length === 1 ? info.label : `${test.label} · ${info.label}`,
      unit: info.unit,
      higherIsBetter: info.higherIsBetter,
    })),
  );
}

function scatterOptions(meta: CategoryMeta, tests: TestInfo[], scored: boolean): YAxisOption[] {
  const metrics = meta.report
    ? resolveColumns(meta.report.scatterMetrics, tests)
    : allColumns(tests);
  return [
    ...(scored ? [{ id: "score", label: "Composite score" }] : []),
    ...metrics.map((column) => ({
      id: metricKey(column.test, column.metric),
      label: column.label,
      metric: metricKey(column.test, column.metric),
      unit: column.unit,
      higherIsBetter: column.higherIsBetter,
    })),
  ];
}

const dashboards = new Map<string, DashboardData>();

/** Everything a category's dashboard renders, computed once at build time. */
export function loadDashboard(slug: string): DashboardData {
  let dashboard = dashboards.get(slug);
  if (!dashboard) {
    dashboard = buildDashboard(slug);
    dashboards.set(slug, dashboard);
  }
  return dashboard;
}

function buildDashboard(slug: string): DashboardData {
  const runs = runsByCategory(slug);
  if (runs.length === 0) throw new Error(`category ${slug} has no reports`);
  const meta = categoryMeta(slug);
  const catalog = loadCatalog().find((entry) => entry.name === slug);

  const current = currentScoredGroups(aggregateRuns(runs));
  const subjects = dashboardSubjects(current);
  const colors = providerColors(current.map((group) => group.provider.name ?? "unknown"));
  const plans = distinguishPlans(
    sortPlans(
      subjects.map((subject) => toPlanDatum(subject, colors.get(subject.primary.provider.name ?? "unknown")!)),
      PROVIDERS.map((p) => p.slug),
    ),
  );

  const tests = collectTests(meta, plans, reportOrder(runs), catalog?.tests ?? []);
  const scored = isScoredCategory(slug);
  const priced = plans.some((plan) => plan.priceMonth !== undefined && plan.priceMonth > 0);
  const updated = runs.map((r) => r.created_at).sort().at(-1);
  const protocols = [...new Set(plans.map((plan) => plan.protocol))].sort();

  return {
    meta: {
      slug: meta.slug,
      name: meta.name,
      tagline: meta.tagline,
      description: meta.description,
      noun: meta.noun,
      headline: meta.headline,
      lead: meta.lead,
      measuresMachine: Boolean(meta.measuresMachine),
    },
    plans,
    sample: anySample(runs),
    scored,
    priced,
    sections: buildSections(meta, tests, plans),
    boardColumns: meta.report ? resolveColumns(meta.report.tableMetrics, tests) : allColumns(tests),
    yOptions: priced ? scatterOptions(meta, tests, scored) : [],
    stats: {
      providers: new Set(plans.map((p) => p.provider)).size,
      plans: plans.length,
      freshHosts: current.reduce((sum, group) => sum + group.freshHostCount, 0),
      runs: runs.length,
      updated: updated ? formatMeasurementDate(updated) : "—",
    },
    method: {
      protocols,
      protocolDoc: catalog?.protocol
        ? { protocol: catalog.protocol, href: protocolUrl(catalog.protocol) }
        : undefined,
      command: catalog ? `providerbench run --category ${slug}` : undefined,
      tests: tests.map((test) => ({
        name: test.test,
        label: test.label,
        description: test.summary,
        sourceUrl: test.sourceUrl,
      })),
    },
  };
}
