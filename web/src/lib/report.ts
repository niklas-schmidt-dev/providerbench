// Report specs: the declarative layer that turns the metric registry into
// pages. A benchmark category ships a spec (chart sections, table columns,
// scatter metrics) and the report components render it — adding a category
// means adding data here, never page code.

import { getMetricDef } from "@/lib/metrics";

/** A pointer at one registered metric in lib/metrics.ts. */
export type MetricRef = {
  test: string;
  metric: string;
  /** Short column/axis label when the registry title is too long. */
  shortLabel?: string;
  /** Decimal places for table cells; default is magnitude-based. */
  decimals?: number;
};

/** A numbered report section: a rule heading plus its chart grid. */
export type ReportSection = {
  title: string;
  description?: string;
  charts: MetricRef[];
};

export type ScatterMetricRef = MetricRef & {
  /** Stable id for client-side toggle state. */
  id: string;
};

/** Everything a category page (and the homepage) needs to render itself. */
export type ReportSpec = {
  /** Headline charts on the homepage — one best plan per provider. */
  leaderCharts: MetricRef[];
  /** Numbered chart sections on the category page. */
  sections: ReportSection[];
  /** Ledger columns on homepage + category comparison tables. */
  tableMetrics: MetricRef[];
  /** Toggleable y-axes for the price/performance scatter. */
  scatterMetrics: ScatterMetricRef[];
};

/** A table column with unit/direction resolved from the metric registry. */
export type TableColumn = {
  label: string;
  unit: string;
  test: string;
  metric: string;
  higherIsBetter: boolean;
  format: (v: number) => string;
};

function decimalFormat(decimals: number) {
  return (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
}

// Wide dynamic range across metrics (IOPS in the thousands, ratios near 1)
// makes one fixed precision useless — derive it from the value's magnitude.
function autoFormat(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return decimalFormat(0)(v);
  if (abs >= 10) return decimalFormat(1)(v);
  return decimalFormat(2)(v);
}

export function resolveTableColumns(refs: MetricRef[]): TableColumn[] {
  return refs.map((ref) => {
    const def = getMetricDef(ref.test, ref.metric);
    if (!def) {
      throw new Error(
        `unknown metric ${ref.test}.${ref.metric} — add it to lib/metrics.ts`,
      );
    }
    return {
      label: ref.shortLabel ?? def.title,
      unit: def.unit,
      test: ref.test,
      metric: ref.metric,
      higherIsBetter: def.higherIsBetter,
      format: ref.decimals === undefined ? autoFormat : decimalFormat(ref.decimals),
    };
  });
}

export type ScatterMetric = {
  id: string;
  test: string;
  metric: string;
  label: string;
};

export function resolveScatterMetrics(refs: ScatterMetricRef[]): ScatterMetric[] {
  return refs.map((ref) => ({
    id: ref.id,
    test: ref.test,
    metric: ref.metric,
    label: ref.shortLabel ?? getMetricDef(ref.test, ref.metric)?.title ?? ref.metric,
  }));
}
