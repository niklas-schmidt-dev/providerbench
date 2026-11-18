"use client";

import { useMemo, useState } from "react";

import { ChartPanel, Segmented, ToggleCheck } from "@/components/charts/chart-panel";
import { ChartTooltip, TooltipHeader, TooltipRow } from "@/components/charts/chart-tooltip";
import { formatEuro, formatTick, linearScale, logScale } from "@/components/charts/scales";
import { useWidth } from "@/components/charts/use-width";
import { CompanyLogo } from "@/components/company-logo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMetricValue } from "@/lib/format";
import type { PlanDatum } from "@/lib/plans";
import { providerColor } from "@/lib/providers";

export type YAxisOption = {
  id: string;
  label: string;
  /** `${test}.${metric}`; omitted = composite score. */
  metric?: string;
  unit?: string;
};

type Point = { plan: PlanDatum; x: number; y: number; price: number; value: number };

const LABEL_GAP = 22;

function yValue(plan: PlanDatum, option: YAxisOption): number | undefined {
  return option.metric ? plan.metrics[option.metric]?.p50 : plan.score;
}

/**
 * Price on x, performance on y, one line per provider through its plans —
 * the "cost vs capability" view. Lines end in direct labels; a Pareto line
 * marks the plans nobody beats on both axes.
 */
export function PricePerformanceChart({
  id,
  plans,
  yOptions,
  title = "Price vs performance",
  description,
}: {
  id?: string;
  plans: PlanDatum[];
  yOptions: YAxisOption[];
  title?: string;
  description?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [scale, setScale] = useState<"log" | "linear">("log");
  const [pareto, setPareto] = useState(false);
  const [yId, setYId] = useState(yOptions[0]?.id ?? "score");
  const [hovered, setHovered] = useState<string | null>(null);
  const option = yOptions.find((o) => o.id === yId) ?? yOptions[0];

  const compact = width < 640;
  const margin = { top: 30, right: compact ? 16 : 200, bottom: 48, left: 52 };
  const height = compact ? 340 : Math.round(Math.min(560, Math.max(380, width * 0.46)));
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const model = useMemo(() => {
    const raw = plans.flatMap((plan) => {
      const value = yValue(plan, option);
      const price = plan.priceMonth;
      return price && price > 0 && value !== undefined ? [{ plan, price, value }] : [];
    });
    if (raw.length === 0) return null;
    const prices = raw.map((p) => p.price);
    const x =
      scale === "log"
        ? logScale([Math.min(...prices), Math.max(...prices)], [margin.left, margin.left + plotW])
        : linearScale([0, Math.max(...prices)], [margin.left, margin.left + plotW], compact ? 4 : 6);
    const y = linearScale(
      [0, Math.max(...raw.map((p) => p.value))],
      [margin.top + plotH, margin.top],
      compact ? 4 : 5,
    );
    const points: Point[] = raw.map((p) => ({ ...p, x: x(p.price), y: y(p.value) }));

    const series = new Map<string, Point[]>();
    for (const point of points) {
      const list = series.get(point.plan.provider) ?? [];
      list.push(point);
      series.set(point.plan.provider, list);
    }
    for (const list of series.values()) list.sort((a, b) => a.price - b.price);

    // Direct labels at each line's right end, pushed apart to stay legible;
    // a leader line keeps every label attached to its series.
    const labels = [...series.entries()]
      .map(([provider, list]) => {
        const end = list[list.length - 1];
        return { provider, plan: end.plan, anchorX: end.x, anchorY: end.y, y: end.y };
      })
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      labels[i].y = Math.max(labels[i].y, labels[i - 1].y + LABEL_GAP);
    }
    const overflow = labels.length ? labels[labels.length - 1].y - (margin.top + plotH) : 0;
    if (overflow > 0) for (const label of labels) label.y -= overflow;

    const frontier: Point[] = [];
    for (const point of [...points].sort((a, b) => a.price - b.price || b.value - a.value)) {
      if (frontier.length === 0 || point.value > frontier[frontier.length - 1].value) frontier.push(point);
    }

    return { x, y, points, series, labels, frontier };
  }, [plans, option, scale, plotW, plotH, compact, margin.left, margin.top]);

  const hoveredPoint = model?.points.find((p) => p.plan.id === hovered);
  const hoveredProvider = hoveredPoint?.plan.provider;
  const unit = option?.unit;

  const controls = (
    <>
      {yOptions.length > 1 && (
        <Select value={yId} onValueChange={(value) => value && setYId(value)}>
          <SelectTrigger size="sm" aria-label="Performance metric" className="min-w-40 text-[13px]">
            <SelectValue>{(value: string) => yOptions.find((o) => o.id === value)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {yOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <ToggleCheck checked={pareto} onChange={setPareto}>
        Pareto line
      </ToggleCheck>
      <Segmented
        label="Price axis scale"
        value={scale}
        onChange={setScale}
        options={[
          { value: "linear", label: "Linear" },
          { value: "log", label: "Log" },
        ]}
      />
    </>
  );

  return (
    <ChartPanel
      id={id}
      title={title}
      description={description}
      controls={controls}
      footer={
        <>
          Each point is one plan: list price (net, excl. VAT) against the cross-host P50 of{" "}
          {option?.label.toLowerCase() ?? "the composite score"}. Lines join a provider&rsquo;s plans from cheapest to
          most expensive. Hollow points are provisional cohorts that do not rank yet.
        </>
      }
    >
      <div ref={ref} className="relative">
        {!model ? (
          <p className="py-16 text-center text-[13px] text-muted-foreground">
            No priced plans in the current selection. Turn plans back on in the sidebar.
          </p>
        ) : (
          <>
            <svg
              role="img"
              aria-label={`${title}: price per month against ${option?.label ?? "score"}`}
              width="100%"
              viewBox={`0 0 ${width} ${height}`}
              className="block overflow-visible"
            >
              {model.y.ticks.map((tick) => (
                <g key={`y${tick}`}>
                  <line
                    x1={margin.left}
                    x2={margin.left + plotW}
                    y1={model.y(tick)}
                    y2={model.y(tick)}
                    stroke={tick === 0 ? "var(--border-strong)" : "var(--grid)"}
                    strokeDasharray={tick === 0 ? undefined : "1 4"}
                    strokeLinecap="round"
                  />
                  <text
                    x={margin.left - 12}
                    y={model.y(tick)}
                    dy="0.32em"
                    textAnchor="end"
                    className="num fill-subtle text-[12px]"
                  >
                    {formatTick(tick)}
                  </text>
                </g>
              ))}
              {model.x.ticks.map((tick) => (
                <g key={`x${tick}`}>
                  <line
                    x1={model.x(tick)}
                    x2={model.x(tick)}
                    y1={margin.top + plotH}
                    y2={margin.top + plotH + 5}
                    stroke="var(--border-strong)"
                  />
                  <text
                    x={model.x(tick)}
                    y={margin.top + plotH + 20}
                    textAnchor="middle"
                    className="num fill-subtle text-[12px]"
                  >
                    {formatEuro(tick)}
                  </text>
                </g>
              ))}
              <text x={margin.left} y={12} className="fill-muted-foreground text-[12px]">
                {option?.label ?? "Composite score"}
                {unit ? ` (${unit})` : ""}
              </text>
              <text
                x={margin.left + plotW / 2}
                y={height - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[12px]"
              >
                Price per month (EUR{scale === "log" ? ", log scale" : ""})
              </text>

              {pareto && model.frontier.length > 1 && (
                <path
                  d={model.frontier.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth={1.25}
                  strokeDasharray="5 5"
                />
              )}

              {!compact &&
                model.labels.map((label) => (
                  <line
                    key={`leader-${label.provider}`}
                    x1={label.anchorX + 8}
                    y1={label.anchorY}
                    x2={margin.left + plotW + 18}
                    y2={label.y}
                    stroke="var(--grid)"
                    opacity={hoveredProvider && hoveredProvider !== label.provider ? 0.3 : 1}
                  />
                ))}

              {[...model.series.entries()].map(([provider, points]) => {
                const color = providerColor(provider);
                const dimmed = hoveredProvider !== undefined && hoveredProvider !== provider;
                return (
                  <g key={provider} opacity={dimmed ? 0.25 : 1} className="transition-opacity duration-150">
                    {points.length > 1 && (
                      <path
                        d={points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    )}
                    {points.map((point, index) => (
                      <a
                        key={point.plan.id}
                        href={`/providers/${provider}`}
                        aria-label={`${point.plan.providerName} ${point.plan.plan}${point.plan.region ? `, ${point.plan.region}` : ""}: ${formatEuro(point.price)} per month, ${option?.label ?? "score"} ${formatMetricValue(point.value)}${point.plan.rankEligible ? "" : ", provisional"}`}
                        onMouseEnter={() => setHovered(point.plan.id)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(point.plan.id)}
                        onBlur={() => setHovered(null)}
                        className="outline-none [&:focus-visible>circle:last-child]:stroke-foreground"
                      >
                        <circle cx={point.x} cy={point.y} r={14} fill="transparent" />
                        {!compact && plans.length <= 12 && (
                          <text
                            x={point.x + 9}
                            // Sit below the point when the line leaves it upward, so the label never crosses its own line.
                            y={(points[index + 1]?.y ?? Infinity) < point.y ? point.y + 17 : point.y - 9}
                            className="pointer-events-none fill-subtle text-[11px]"
                          >
                            {point.plan.plan}
                          </text>
                        )}
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={hovered === point.plan.id ? 6 : 4.5}
                          fill={point.plan.rankEligible ? color : "var(--background)"}
                          stroke={point.plan.rankEligible ? "var(--background)" : color}
                          strokeWidth={2}
                          className="transition-[r] duration-150"
                        />
                      </a>
                    ))}
                  </g>
                );
              })}
            </svg>

            {!compact &&
              model.labels.map((label) => (
                <div
                  key={`label-${label.provider}`}
                  className="pointer-events-none absolute flex -translate-y-1/2 items-center gap-2 text-[13px] font-medium whitespace-nowrap transition-opacity duration-150"
                  style={{
                    left: `${((margin.left + plotW + 24) / width) * 100}%`,
                    top: `${(label.y / height) * 100}%`,
                    opacity: hoveredProvider && hoveredProvider !== label.provider ? 0.3 : 1,
                  }}
                >
                  <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: providerColor(label.provider) }} />
                  {label.plan.company && <CompanyLogo company={label.plan.company} size="sm" decorative />}
                  {label.plan.providerName}
                </div>
              ))}

            {hoveredPoint && (
              <ChartTooltip x={hoveredPoint.x} y={hoveredPoint.y} width={width}>
                <TooltipHeader plan={hoveredPoint.plan} />
                {hoveredPoint.plan.region && <TooltipRow label="Region" value={hoveredPoint.plan.region} />}
                <TooltipRow label="Price / month" value={formatEuro(hoveredPoint.price)} />
                <TooltipRow
                  label={option?.label ?? "Score"}
                  value={`${formatMetricValue(hoveredPoint.value)}${unit ? ` ${unit}` : ""}`}
                />
                <TooltipRow label="Fresh hosts" value={hoveredPoint.plan.hostCount} />
                {!hoveredPoint.plan.rankEligible && (
                  <p className="mt-1 text-subtle">Provisional · not ranked yet</p>
                )}
              </ChartTooltip>
            )}

            {compact && (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px]">
                {[...model.series.values()].map((points) => (
                  <li key={points[0].plan.provider} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: providerColor(points[0].plan.provider) }} />
                    {points[0].plan.providerName}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </ChartPanel>
  );
}
