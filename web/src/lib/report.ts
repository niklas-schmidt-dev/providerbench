// Report specs: the curated part of a category's dashboard. A category
// without a spec is laid out from its reports (lib/sections.ts); a spec picks
// which metrics become board columns and scatter axes when showing all of
// them would bury the ones that matter.

/** A pointer at one metric of a category. */
export type MetricRef = {
  test: string;
  metric: string;
  /** Short column/axis label when the metric's title is too long. */
  shortLabel?: string;
  /** Decimal places for table cells; default is magnitude-based. */
  decimals?: number;
};

export type ReportSpec = {
  /** Board columns, in order. */
  tableMetrics: MetricRef[];
  /** Selectable y-axes of the price/performance scatter. */
  scatterMetrics: MetricRef[];
};

/** A board column, ready to send to the client. */
export type BoardColumn = {
  test: string;
  metric: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  decimals?: number;
};

/** Fixed decimals for a column that asks for them. */
export function decimalFormat(decimals: number): (v: number) => string {
  return (v) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
}
