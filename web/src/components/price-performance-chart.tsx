"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChartWatermark } from "@/components/chart-frame";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue, planCpuParts } from "@/lib/format";
import { getMetricDef } from "@/lib/metrics";
import { providerColor, providerLabel } from "@/lib/providers";
import { cn } from "@/lib/utils";

// The scatter plots price against REAL measured metrics — no synthetic
// composite index in a chart. Only higher-is-better metrics belong here so
// "up and to the left wins" always reads true.
const SCATTER_METRICS = [
  { id: "cpu-multi", test: "cpu", metric: "multi_core_hash", label: "CPU all-core" },
  { id: "cpu-single", test: "cpu", metric: "single_core_hash", label: "CPU 1-core" },
  { id: "memory", test: "memory", metric: "copy_bandwidth", label: "Memory BW" },
  { id: "disk", test: "disk", metric: "rand_read_4k", label: "4K read" },
  { id: "network", test: "network", metric: "download", label: "Download" },
] as const;

type ScatterMetric = (typeof SCATTER_METRICS)[number];

type Point = {
  id: string;
  label: string;
  detail: string;
  provider: string;
  price: number;
  value: number;
  hostCount: number;
  cohortId: string;
  measuredFrom: string;
  measuredTo: string;
  rankEligible: boolean;
  fill: string;
};

type PriceScale = "linear" | "log";

// SSR fallback only — the real width is measured, so circles stay circles and
// text is never stretched by a distorting viewBox.
const FALLBACK_WIDTH = 1000;
const CHART_HEIGHT = 420;
const CHART_MARGIN = { top: 28, right: 32, bottom: 56, left: 68 };

function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const niceFraction =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const step = niceStep(Math.abs(max - min) / Math.max(1, count - 1));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
}

// Cropped-but-clean vertical scale: snap the domain outward to round steps so
// the data fills the plot AND every gridline lands on a readable number.
function snappedRange(
  min: number,
  max: number,
): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { domain: [min - pad, max + pad], ticks: [min] };
  }
  const step = niceStep((max - min) / 4);
  const lo = Math.max(0, Math.floor(min / step - 0.5) * step);
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step * 0.001; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return { domain: [lo, hi], ticks };
}

function logTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  const startPower = Math.floor(Math.log10(min));
  const endPower = Math.ceil(Math.log10(max));
  for (let power = startPower; power <= endPower; power += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** power;
      if (value >= min && value <= max) ticks.push(value);
    }
  }
  return ticks.length <= 8
    ? ticks
    : ticks.filter((value) => Math.log10(value) % 1 === 0);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - position) + sorted[upper] * (position - lower);
}

function outlierIds(points: Point[]): Set<string> {
  if (points.length < 4) return new Set();

  const fences = (values: number[]) => {
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    return [q1 - iqr * 1.5, q3 + iqr * 1.5] as const;
  };
  const [priceLow, priceHigh] = fences(points.map((point) => point.price));
  const [valueLow, valueHigh] = fences(points.map((point) => point.value));

  return new Set(
    points
      .filter(
        (point) =>
          point.price < priceLow ||
          point.price > priceHigh ||
          point.value < valueLow ||
          point.value > valueHigh,
      )
      .map((point) => point.id),
  );
}

function efficientFrontier(points: Point[]): Point[] {
  let bestValue = -Infinity;
  return [...points]
    .sort((a, b) => a.price - b.price || b.value - a.value)
    .filter((point) => {
      if (point.value <= bestValue) return false;
      bestValue = point.value;
      return true;
    });
}

export function PricePerformanceChart({ groups }: { groups: ScoredGroup[] }) {
  const [metricId, setMetricId] = useState<ScatterMetric["id"]>(
    SCATTER_METRICS[0].id,
  );
  const activeMetric =
    SCATTER_METRICS.find((candidate) => candidate.id === metricId) ??
    SCATTER_METRICS[0];
  const metricDef = getMetricDef(activeMetric.test, activeMetric.metric);
  const unit = metricDef?.unit ?? "";

  const points = useMemo<Point[]>(
    () =>
      groups.flatMap((group) => {
        const price = group.provider.price_eur_month;
        const provider = group.provider.name;
        const value = metricSummary(
          group,
          activeMetric.test,
          activeMetric.metric,
        )?.distribution.p50;
        if (!price || !provider || value === undefined || value <= 0) return [];
        const region = group.provider.region?.toUpperCase();
        const cpuParts = planCpuParts(group.provider.tier, group.system.cpu_cores);
        return [
          {
            id: group.id,
            label: [
              providerLabel(provider),
              group.provider.plan,
              region ? `· ${region}` : undefined,
            ]
              .filter(Boolean)
              .join(" "),
            detail: [cpuParts.tier, group.provider.region, cpuParts.cpu]
              .filter(Boolean)
              .join(" · "),
            provider,
            price,
            value,
            hostCount: group.hostCount,
            cohortId: group.cohortId,
            measuredFrom: group.measuredFrom,
            measuredTo: group.measuredTo,
            rankEligible: group.rankEligible,
            fill: providerColor(provider),
          },
        ];
      }),
    [groups, activeMetric],
  );

  const [disabledProviders, setDisabledProviders] = useState<Set<string>>(
    new Set(),
  );
  const [includeOutliers, setIncludeOutliers] = useState(true);
  const [priceScale, setPriceScale] = useState<PriceScale>("linear");
  const [showLabels, setShowLabels] = useState(true);
  const [showFrontier, setShowFrontier] = useState(true);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);

  const plotRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setChartWidth(Math.max(360, width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) return null;

  const providers = [...new Set(points.map((point) => point.provider))].sort(
    (a, b) => providerLabel(a).localeCompare(providerLabel(b)),
  );
  const providerPoints = points.filter(
    (point) => !disabledProviders.has(point.provider),
  );
  const detectedOutliers = outlierIds(providerPoints);
  const visiblePoints = includeOutliers
    ? providerPoints
    : providerPoints.filter((point) => !detectedOutliers.has(point.id));
  const frontierIds = new Set(
    efficientFrontier(visiblePoints.filter((point) => point.rankEligible)).map(
      (point) => point.id,
    ),
  );

  const priceValues = visiblePoints.map((point) => point.price);
  const metricValues = visiblePoints.map((point) => point.value);
  const priceMin = Math.min(...priceValues);
  const priceMax = Math.max(...priceValues);
  const xDomain: [number, number] =
    priceScale === "log"
      ? [
          Math.max(0.01, priceMin / 1.3),
          Math.max(priceMin * 1.1, priceMax * 1.25),
        ]
      : [0, Math.ceil(priceMax * 1.14)];
  const { domain: yDomain, ticks: yTicks } = snappedRange(
    Math.min(...metricValues),
    Math.max(...metricValues),
  );
  const plotWidth =
    chartWidth - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight =
    CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const xPosition = (price: number) => {
    const ratio =
      priceScale === "log"
        ? (Math.log(price) - Math.log(xDomain[0])) /
          (Math.log(xDomain[1]) - Math.log(xDomain[0]))
        : (price - xDomain[0]) / (xDomain[1] - xDomain[0]);
    return CHART_MARGIN.left + ratio * plotWidth;
  };
  const yPosition = (value: number) =>
    CHART_MARGIN.top +
    ((yDomain[1] - value) / (yDomain[1] - yDomain[0])) * plotHeight;
  const xTicks =
    priceScale === "log"
      ? logTicks(xDomain[0], xDomain[1])
      : niceTicks(xDomain[0], xDomain[1]);
  const hoveredPoint = visiblePoints.find(
    (point) => point.id === hoveredPointId,
  );

  const hasCustomView =
    disabledProviders.size > 0 ||
    !includeOutliers ||
    priceScale !== "linear" ||
    !showLabels ||
    !showFrontier;

  const resetView = () => {
    setDisabledProviders(new Set());
    setIncludeOutliers(true);
    setPriceScale("linear");
    setShowLabels(true);
    setShowFrontier(true);
  };

  const toggleProvider = (provider: string) => {
    const activeCount = providers.length - disabledProviders.size;
    if (!disabledProviders.has(provider) && activeCount === 1) return;
    setDisabledProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  return (
    <Card className="overflow-hidden py-0">
      <div
        className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
        aria-label="Scatter metric"
        role="group"
      >
        {SCATTER_METRICS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMetricId(option.id)}
            aria-pressed={activeMetric.id === option.id}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-[12px] whitespace-nowrap transition-colors",
              activeMetric.id === option.id
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <CardHeader className="gap-1.5 border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-[15px] font-semibold">
            {activeMetric.label} vs. monthly price
          </CardTitle>
          <span className="font-mono text-[11px] text-muted-foreground">
            {visiblePoints.length} / {points.length} plans
          </span>
        </div>
        <p className="max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
          Cross-host P50 against the net monthly price (EUR, excluding VAT —
          tax depends on the buyer, not the provider). Ringed dots sit on the
          efficient frontier: no cheaper measured plan is faster on this
          metric. Points are deliberately never connected.
        </p>
        <div className="mt-1.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {providers.map((provider) => {
              const active = !disabledProviders.has(provider);
              return (
                <button
                  key={provider}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleProvider(provider)}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11.5px] transition-opacity",
                    active
                      ? "text-foreground/85 hover:text-foreground"
                      : "text-muted-foreground opacity-45 hover:opacity-70",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: providerColor(provider) }}
                  />
                  {providerLabel(provider)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-muted-foreground">View</span>
            <Button
              type="button"
              size="xs"
              variant={includeOutliers ? "secondary" : "outline"}
              aria-pressed={includeOutliers}
              onClick={() => setIncludeOutliers((value) => !value)}
              title="Tukey 1.5× IQR across visible price and performance"
            >
              {includeOutliers
                ? `Outliers on · ${detectedOutliers.size}`
                : `${detectedOutliers.size} outlier${detectedOutliers.size === 1 ? "" : "s"} hidden`}
            </Button>
            <div className="flex rounded-lg border border-white/8 bg-background/35 p-0.5">
              {(["linear", "log"] as const).map((scale) => (
                <Button
                  key={scale}
                  type="button"
                  size="xs"
                  variant={priceScale === scale ? "secondary" : "ghost"}
                  aria-pressed={priceScale === scale}
                  onClick={() => setPriceScale(scale)}
                  className="h-5.5 rounded-md px-2 capitalize"
                >
                  {scale}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              size="xs"
              variant={showLabels ? "secondary" : "ghost"}
              aria-pressed={showLabels}
              onClick={() => setShowLabels((value) => !value)}
            >
              Labels
            </Button>
            <Button
              type="button"
              size="xs"
              variant={showFrontier ? "secondary" : "ghost"}
              aria-pressed={showFrontier}
              onClick={() => setShowFrontier((value) => !value)}
            >
              Frontier
            </Button>
            {hasCustomView ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={resetView}
                className="text-muted-foreground"
              >
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4 pt-3 sm:px-5">
        <div ref={plotRef} className="relative h-[420px] w-full">
          <ChartWatermark className="top-1 right-3" />
          <svg
            viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
            role="img"
            aria-labelledby="price-performance-chart-title"
            className="size-full overflow-visible"
          >
            <title id="price-performance-chart-title">
              {activeMetric.label} versus monthly price. Lower prices and
              higher values are better. Points are not connected.
            </title>
            {xTicks.map((tick) => (
              <text
                key={`x-${tick}`}
                x={xPosition(tick)}
                y={CHART_MARGIN.top + plotHeight + 23}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="11"
              >
                €{tick < 10 ? tick.toFixed(0) : Math.round(tick)}
              </text>
            ))}
            {yTicks.map((tick) => {
              const y = yPosition(tick);
              return (
                <g key={`y-${tick}`}>
                  <line
                    x1={CHART_MARGIN.left}
                    x2={CHART_MARGIN.left + plotWidth}
                    y1={y}
                    y2={y}
                    stroke="var(--foreground)"
                    strokeOpacity="0.08"
                    strokeDasharray="2 6"
                  />
                  <text
                    x={CHART_MARGIN.left - 12}
                    y={y + 4}
                    textAnchor="end"
                    fill="var(--muted-foreground)"
                    fontSize="11"
                  >
                    {tick === 0 ? "0" : formatMetricValue(tick)}
                  </text>
                </g>
              );
            })}
            <text
              x={CHART_MARGIN.left + plotWidth / 2}
              y={CHART_HEIGHT - 7}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="10.5"
            >
              Monthly price (EUR net of VAT, {priceScale} scale)
            </text>
            <text
              x="14"
              y={CHART_MARGIN.top + plotHeight / 2}
              transform={`rotate(-90 14 ${CHART_MARGIN.top + plotHeight / 2})`}
              textAnchor="middle"
              fill="var(--muted-foreground)"
              fontSize="10.5"
            >
              {activeMetric.label} ({unit})
            </text>
            {visiblePoints.map((point) => {
              const x = xPosition(point.price);
              const y = yPosition(point.value);
              const onFrontier = showFrontier && frontierIds.has(point.id);
              const hovered = hoveredPointId === point.id;
              const labelX = Math.min(
                chartWidth - 110,
                Math.max(CHART_MARGIN.left + 65, x),
              );
              return (
                <g
                  key={point.id}
                  onMouseEnter={() => setHoveredPointId(point.id)}
                  onMouseLeave={() => setHoveredPointId(null)}
                  onFocus={() => setHoveredPointId(point.id)}
                  onBlur={() => setHoveredPointId(null)}
                  className="cursor-help outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.label}: ${formatMetricValue(point.value)} ${unit}, €${point.price.toFixed(2)} per month`}
                >
                  {/* Oversized invisible hit target — the visible dot stays small. */}
                  <circle cx={x} cy={y} r="14" fill="transparent" />
                  {onFrontier ? (
                    <circle
                      cx={x}
                      cy={y}
                      r="9.5"
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth="1.5"
                      strokeOpacity="0.9"
                    />
                  ) : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={hovered ? 7 : 5.5}
                    fill={point.fill}
                    fillOpacity={point.rankEligible ? 1 : 0.4}
                    stroke="var(--card)"
                    strokeWidth="1.5"
                    style={{ transition: "r 120ms ease" }}
                  />
                  {showLabels ? (
                    <text
                      x={labelX}
                      y={y - 15}
                      textAnchor="middle"
                      fill="var(--foreground)"
                      fontSize="10"
                      pointerEvents="none"
                    >
                      {point.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {hoveredPoint ? (
            <div
              className={`pointer-events-none absolute z-10 grid min-w-56 grid-cols-[auto_auto] gap-x-4 gap-y-1 rounded-lg border bg-background px-3 py-2.5 text-xs shadow-xl ${
                xPosition(hoveredPoint.price) > chartWidth * 0.68
                  ? "-translate-x-full -ml-3"
                  : "ml-3"
              } ${
                yPosition(hoveredPoint.value) < CHART_HEIGHT * 0.38
                  ? "mt-3"
                  : "-translate-y-full -mt-3"
              }`}
              style={{
                left: `${(xPosition(hoveredPoint.price) / chartWidth) * 100}%`,
                top: `${(yPosition(hoveredPoint.value) / CHART_HEIGHT) * 100}%`,
              }}
            >
              <span className="col-span-2 font-medium text-foreground">
                {hoveredPoint.label}
              </span>
              <span className="col-span-2 text-[11px] text-muted-foreground">
                {hoveredPoint.detail}
              </span>
              <span className="text-muted-foreground">{activeMetric.label}</span>
              <span className="text-right font-mono">
                {formatMetricValue(hoveredPoint.value)} {unit}
              </span>
              <span className="text-muted-foreground">Price</span>
              <span className="text-right font-mono">
                €{hoveredPoint.price.toFixed(2)}/mo
              </span>
              <span className="text-muted-foreground">Evidence</span>
              <span className="text-right font-mono">
                {hoveredPoint.hostCount} hosts
                {!hoveredPoint.rankEligible ? " · provisional" : ""}
              </span>
              <span className="text-muted-foreground">Measured</span>
              <span className="text-right font-mono">
                {formatMeasurementWindow(
                  hoveredPoint.measuredFrom,
                  hoveredPoint.measuredTo,
                )}
              </span>
              <span className="text-muted-foreground">Cohort</span>
              <span className="text-right font-mono">
                {hoveredPoint.cohortId}
              </span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1 text-[11px] text-muted-foreground">
          <span>
            Ringed dots are on the efficient frontier for this metric.
          </span>
          <span className="text-warning">
            Faded points need 10 independent fresh hosts before ranking.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
