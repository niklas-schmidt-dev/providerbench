// Lays a category's dashboard out from its reports. Nothing here knows a
// category by name: the shape of the data picks the form.
//
//   - A test becomes a suite: one bar chart with a switch between its metrics.
//   - A test whose metrics are all like for like (same unit, same direction,
//     four or more) becomes a matrix instead: rows against those metrics on
//     one scale. Round-trip time to nine regions reads as a table, not as
//     nine bar charts.
//   - Tests that share such a set of metrics share one matrix, with a switch
//     between them and a mean over all of them.
//   - Tests that record how each item went get an outcomes view.

import { variantLabel, type CategoryMeta } from "@/lib/categories";
import type { CatalogTest } from "@/lib/data";
import { describeMetric, suiteDef, type MetricInfo } from "@/lib/metrics";
import { metricKey, outcomesOf, TESTS_SOURCE_URL, type PlanDatum } from "@/lib/plans";
import { commonPrefix, humanize, withoutPrefix } from "@/lib/text";

/** Fewer like-for-like metrics than this read better as bars with a switch. */
const MATRIX_MIN_METRICS = 4;

export type TestInfo = {
  test: string;
  label: string;
  summary?: string;
  sourceUrl: string;
  metrics: MetricInfo[];
};

export type SuiteSection = {
  kind: "suite";
  id: string;
  title: string;
  tab: string;
  summary?: string;
  sourceUrl: string;
  metrics: MetricInfo[];
  defaultMetric?: string;
};

export type MatrixSection = {
  kind: "matrix";
  id: string;
  title: string;
  tab: string;
  unit: string;
  higherIsBetter: boolean;
  /** The tests that share these columns. More than one adds a switch. */
  tests: { test: string; anchor: string; label: string; summary?: string; sourceUrl: string }[];
  columns: { metric: string; label: string }[];
};

export type OutcomesSection = {
  kind: "outcomes";
  id: string;
  title: string;
  tab: string;
  tests: { test: string; label: string }[];
  variants: { key: string; label: string }[];
  /** Items come in this many equal groups, in order. */
  groups?: { count: number; label: string };
};

export type Section = SuiteSection | MatrixSection | OutcomesSection;

/** The tests and their metrics, in the order the reports list them. */
export type ReportOrder = { tests: string[]; metrics: Map<string, string[]> };

/** Ids the dashboard uses for its own sections; a test named like one steps aside. */
const RESERVED_IDS = ["main", "plan-sidebar", "price-performance", "value", "board", "method"];

function testSourceUrl(meta: CategoryMeta, test: string, catalog: Map<string, CatalogTest>): string {
  // Only tests the CLI lists are known to live in a file named after them.
  return meta.sourceDir && catalog.has(test)
    ? `${TESTS_SOURCE_URL.replace("/tree/", "/blob/")}/${meta.sourceDir}/${test}.go`
    : TESTS_SOURCE_URL;
}

/** Every test and metric the rows report, described and in a stable order. */
export function collectTests(
  meta: CategoryMeta,
  plans: PlanDatum[],
  order: ReportOrder,
  catalogTests: CatalogTest[],
): TestInfo[] {
  const catalog = new Map(catalogTests.map((test) => [test.name, test]));
  const rank = (list: string[], value: string) => {
    const index = list.indexOf(value);
    return index === -1 ? list.length : index;
  };
  // A curated order first, then the order the CLI runs its tests in, then
  // the order reports list tests the CLI does not know.
  const preferred = meta.testOrder ?? [];
  const registered = catalogTests.map((test) => test.name);
  const tests = [...order.tests].sort(
    (a, b) =>
      rank(preferred, a) - rank(preferred, b) ||
      rank(registered, a) - rank(registered, b) ||
      rank(order.tests, a) - rank(order.tests, b),
  );

  return tests.flatMap((test) => {
    // Names come from the reports, never from splitting a key: a test or a
    // metric may have a dot in its name.
    const metrics = (order.metrics.get(test) ?? []).flatMap((metric) => {
      const key = metricKey(test, metric);
      const measured = plans.find((plan) => Object.hasOwn(plan.metrics, key))?.metrics[key];
      return measured ? [describeMetric(meta.slug, test, metric, measured, meta.metricLabel?.(test, metric))] : [];
    });
    if (metrics.length === 0) return []; // only in superseded or hidden cohorts
    const def = suiteDef(meta.slug, test);
    return [
      {
        test,
        label: def.label,
        summary: def.summary ?? catalog.get(test)?.description,
        sourceUrl: testSourceUrl(meta, test, catalog),
        metrics,
      },
    ];
  });
}

function matrixSignature(test: TestInfo): string | undefined {
  const [first] = test.metrics;
  if (test.metrics.length < MATRIX_MIN_METRICS) return undefined;
  if (!test.metrics.every((m) => m.unit === first.unit && m.higherIsBetter === first.higherIsBetter)) return undefined;
  // Sorted: two tests share a matrix when they report the same metrics, in whatever order.
  return [first.unit, first.higherIsBetter, ...test.metrics.map((m) => m.metric).sort()].join("|");
}

function uniqueId(wanted: string, taken: Set<string>): string {
  let id = wanted;
  for (let n = 2; taken.has(id); n++) id = `${wanted}-${n}`;
  taken.add(id);
  return id;
}

export function buildSections(meta: CategoryMeta, tests: TestInfo[], plans: PlanDatum[]): Section[] {
  // Every test claims an id first, its own name where that is free: links to
  // a test or a metric build on it. A matrix of several tests and the items
  // view take whatever is left.
  const taken = new Set(RESERVED_IDS);
  const anchors = new Map(tests.map((test) => [test.test, uniqueId(test.test, taken)]));
  const sections: Section[] = [];
  const matrices = new Map<string, MatrixSection>();

  for (const test of tests) {
    const id = anchors.get(test.test)!;
    const signature = matrixSignature(test);
    if (!signature) {
      const def = suiteDef(meta.slug, test.test);
      sections.push({
        kind: "suite",
        id,
        title: def.label,
        tab: def.tab ?? def.label,
        summary: test.summary,
        sourceUrl: test.sourceUrl,
        metrics: test.metrics,
        defaultMetric: def.defaultMetric,
      });
      continue;
    }
    const entry = { test: test.test, anchor: id, label: test.label, summary: test.summary, sourceUrl: test.sourceUrl };
    const existing = matrices.get(signature);
    if (existing) {
      existing.tests.push(entry);
      continue;
    }
    const prefix = commonPrefix(test.metrics.map((m) => m.metric));
    const matrix: MatrixSection = {
      kind: "matrix",
      id,
      title: test.label,
      tab: test.label,
      unit: test.metrics[0].unit,
      higherIsBetter: test.metrics[0].higherIsBetter,
      tests: [entry],
      columns: test.metrics.map((m) => ({
        metric: m.metric,
        label: meta.metricLabel?.(test.test, m.metric) ?? humanize(withoutPrefix(m.metric, prefix)),
      })),
    };
    matrices.set(signature, matrix);
    sections.push(matrix);
  }

  for (const matrix of matrices.values()) {
    // One test keeps its own name and anchor. Several are named after what
    // their metrics have in common ("accuracy").
    if (matrix.tests.length > 1) {
      const prefix = commonPrefix(matrix.columns.map((column) => column.metric));
      matrix.id = uniqueId(prefix ? prefix.replaceAll("_", "-") : "overview", taken);
      matrix.tab = prefix ? humanize(prefix) : "Overview";
      matrix.title = matrix.tab;
    }
    if (meta.matrixTitle && matrices.size === 1) matrix.title = meta.matrixTitle;
  }

  const outcomeTests = tests.filter((test) => plans.some((plan) => outcomesOf(plan, test.test)));
  if (outcomeTests.length > 0) {
    const variants: string[] = [];
    for (const plan of plans) {
      for (const test of outcomeTests) {
        for (const variant of Object.keys(outcomesOf(plan, test.test) ?? {})) {
          if (!variants.includes(variant)) variants.push(variant);
        }
      }
    }
    // Variants follow the order of the metrics named after them where there
    // is one (accuracy_en, accuracy_de, ...), otherwise the order found.
    const metricOrder = outcomeTests[0].metrics.map((m) => m.metric);
    const position = (variant: string) => {
      const index = metricOrder.findIndex((metric) => metric.endsWith(`_${variant}`));
      return index === -1 ? metricOrder.length : index;
    };
    variants.sort((a, b) => position(a) - position(b));
    const outcomes: OutcomesSection = {
      kind: "outcomes",
      id: uniqueId("outcomes", taken),
      title: "Item by item",
      tab: "Items",
      tests: outcomeTests.map((test) => ({ test: test.test, label: test.label })),
      variants: variants.map((key) => ({ key, label: variantLabel(meta, key) })),
      groups: meta.itemGroups,
    };
    // Directly under the last chart of a test it details.
    const detailed = new Set(outcomeTests.map((test) => test.test));
    const after = sections.findLastIndex((section) =>
      section.kind === "matrix"
        ? section.tests.some((test) => detailed.has(test.test))
        : section.kind === "suite" && detailed.has(section.metrics[0].test),
    );
    sections.splice(after + 1, 0, outcomes);
  }
  return sections;
}
