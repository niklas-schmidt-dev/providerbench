"use client";

import { useMemo, useState } from "react";

import { ChartTooltip, TooltipHeader, TooltipRow } from "@/components/charts/chart-tooltip";
import { formatTick, linearScale } from "@/components/charts/scales";
import { useWidth } from "@/components/charts/use-width";
import { CompanyLogo } from "@/components/company-logo";
import { formatMetricValue } from "@/lib/format";
import { priceLabel, type PlanDatum } from "@/lib/plans";
import { providerColor } from "@/lib/providers";

export type BarAccessor = {
  /** Value to plot; undefined drops the plan from this chart. */
  value: (plan: PlanDatum) => number | undefined;
  /** Optional cross-host spread drawn as a whisker (P10–P90). */
  range?: (plan: PlanDatum) => [number, number] | undefined;
  unit?: string;
  higherIsBetter: boolean;
  format?: (value: number) => string;
};

export type BarGrouping = {
  key: (plan: PlanDatum) => string;
  /** Caption under the group; defaults to the provider mark and name. */
  caption?: (plan: PlanDatum) => string;
  /** Label under each column; defaults to the plan name. */
  barLabel?: (plan: PlanDatum) => string;
  /** Shade columns light → full by price inside a group (default true). */
  shadeByPrice?: boolean;
};

const BY_PROVIDER: BarGrouping = { key: (plan) => plan.provider };

type Bar = {
  plan: PlanDatum;
  value: number;
  range?: [number, number];
  shade: number;
};

const MIN_SLOT = 46;

function truncate(text: string): string {
  return text.length > 9 ? `${text.slice(0, 8)}…` : text;
}

/**
 * Bars grouped by provider: one column per plan, shaded light → full by
 * price inside the provider's hue, value on the cap, plan name under the
 * column, provider mark under the group. Whiskers show the cross-host spread.
 */
export function GroupedBars({
  plans,
  accessor,
  label,
  grouping = BY_PROVIDER,
}: {
  plans: PlanDatum[];
  accessor: BarAccessor;
  label: string;
  grouping?: BarGrouping;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const format = accessor.format ?? formatMetricValue;

  const groups = useMemo(() => {
    const byProvider = new Map<string, Bar[]>();
    for (const plan of plans) {
      const value = accessor.value(plan);
      if (value === undefined || !Number.isFinite(value)) continue;
      const key = grouping.key(plan);
      const list = byProvider.get(key) ?? [];
      list.push({ plan, value, range: accessor.range?.(plan), shade: 1 });
      byProvider.set(key, list);
    }
    const result = [...byProvider.entries()].map(([provider, bars]) => {
      bars.sort((a, b) => (a.plan.priceMonth ?? Infinity) - (b.plan.priceMonth ?? Infinity));
      bars.forEach((bar, i) => {
        bar.shade =
          grouping.shadeByPrice === false || bars.length === 1 ? 1 : 0.5 + (0.5 * i) / (bars.length - 1);
      });
      const best = accessor.higherIsBetter
        ? Math.max(...bars.map((b) => b.value))
        : Math.min(...bars.map((b) => b.value));
      return { provider, bars, best };
    });
    // Best provider first, so the ranking reads left to right.
    return result.sort((a, b) => (accessor.higherIsBetter ? b.best - a.best : a.best - b.best));
  }, [plans, accessor, grouping]);

  const barCount = groups.reduce((n, g) => n + g.bars.length, 0);
  const margin = { top: 28, right: 8, bottom: 74, left: 48 };
  const groupGap = 28;
  const innerMin = margin.left + margin.right + barCount * MIN_SLOT + Math.max(0, groups.length - 1) * groupGap;
  const chartWidth = Math.max(width, innerMin);
  const height = width < 640 ? 300 : 360;
  const plotW = chartWidth - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const layout = useMemo(() => {
    if (barCount === 0) return null;
    const maxValue = Math.max(
      ...groups.flatMap((g) => g.bars.map((b) => Math.max(b.value, b.range?.[1] ?? 0))),
    );
    const y = linearScale([0, maxValue], [margin.top + plotH, margin.top], 4);
    const slot = Math.min(84, (plotW - Math.max(0, groups.length - 1) * groupGap) / barCount);
    const barWidth = Math.min(30, slot * 0.62);
    const used = slot * barCount + Math.max(0, groups.length - 1) * groupGap;
    let cursor = margin.left + Math.max(0, (plotW - used) / 2);
    const placed = groups.map((group) => {
      const start = cursor;
      const bars = group.bars.map((bar) => {
        const cx = cursor + slot / 2;
        cursor += slot;
        return { ...bar, cx };
      });
      const end = cursor;
      cursor += groupGap;
      return { ...group, bars, center: (start + end) / 2, start, end };
    });
    return { y, placed, barWidth };
  }, [groups, barCount, plotW, plotH, margin.top, margin.left]);

  const hoveredBar = layout?.placed.flatMap((g) => g.bars).find((b) => b.plan.id === hovered);

  // Keep the measured wrapper mounted so width tracking survives an empty selection.
  if (!layout) {
    return (
      <div ref={ref}>
        <p className="py-16 text-center text-[13px] text-muted-foreground">
          No plan in the current selection reports this metric.
        </p>
      </div>
    );
  }

  const { y, placed, barWidth } = layout;
  const baseline = margin.top + plotH;

  return (
    <div ref={ref} className="relative">
      <div className="overflow-x-auto overscroll-x-contain">
        <svg
          role="img"
          aria-label={label}
          width={chartWidth > width ? chartWidth : "100%"}
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="block"
        >
          {y.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={margin.left + plotW}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? "var(--border-strong)" : "var(--grid)"}
                strokeDasharray={tick === 0 ? undefined : "1 4"}
                strokeLinecap="round"
              />
              <text x={margin.left - 12} y={y(tick)} dy="0.32em" textAnchor="end" className="num fill-subtle text-[12px]">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {accessor.unit && (
            <text x={margin.left} y={12} className="fill-muted-foreground text-[12px]">
              {accessor.unit}
              {accessor.higherIsBetter ? " · higher is better" : " · lower is better"}
            </text>
          )}

          {placed.map((group) => {
            const color = providerColor(group.bars[0].plan.provider);
            const dimmed = hoveredBar !== undefined && grouping.key(hoveredBar.plan) !== group.provider;
            return (
              <g key={group.provider} opacity={dimmed ? 0.35 : 1} className="transition-opacity duration-150">
                {group.bars.map((bar) => {
                  const top = y(bar.value);
                  const h = Math.max(1, baseline - top);
                  const r = Math.min(4, barWidth / 2, h);
                  const x0 = bar.cx - barWidth / 2;
                  const capY = bar.range ? Math.min(top, y(bar.range[1])) : top;
                  return (
                    <g
                      key={bar.plan.id}
                      tabIndex={0}
                      role="img"
                      aria-label={`${bar.plan.providerName} ${bar.plan.plan}: ${format(bar.value)}${accessor.unit ? ` ${accessor.unit}` : ""}`}
                      onMouseEnter={() => setHovered(bar.plan.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(bar.plan.id)}
                      onBlur={() => setHovered(null)}
                      className="outline-none focus-visible:[&>path]:stroke-foreground"
                    >
                      <rect x={bar.cx - 22} y={margin.top} width={44} height={plotH} fill="transparent" />
                      <path
                        d={`M${x0},${baseline} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barWidth - r} Q${x0 + barWidth},${top} ${x0 + barWidth},${top + r} V${baseline} Z`}
                        fill={`color-mix(in oklch, ${color} ${Math.round(bar.shade * 100)}%, var(--background))`}
                        strokeWidth={1.5}
                        opacity={bar.plan.rankEligible ? 1 : 0.55}
                      />
                      {bar.range && (
                        <g stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1}>
                          <line x1={bar.cx} x2={bar.cx} y1={y(bar.range[0])} y2={y(bar.range[1])} />
                          <line x1={bar.cx - 3} x2={bar.cx + 3} y1={y(bar.range[1])} y2={y(bar.range[1])} />
                          <line x1={bar.cx - 3} x2={bar.cx + 3} y1={y(bar.range[0])} y2={y(bar.range[0])} />
                        </g>
                      )}
                      <text x={bar.cx} y={capY - 7} textAnchor="middle" className="num fill-foreground text-[12px] font-medium">
                        {format(bar.value)}
                      </text>
                      <text x={bar.cx} y={baseline + 16} textAnchor="middle" className="fill-subtle text-[11px]">
                        {truncate(grouping.barLabel?.(bar.plan) ?? bar.plan.plan)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>

        {/* Group captions as HTML so the monochrome logo masks render crisply. */}
        <div className="pointer-events-none relative h-0" style={{ width: chartWidth > width ? chartWidth : "100%" }}>
          {placed.map((group) => (
            <div
              key={group.provider}
              className="absolute flex -translate-x-1/2 flex-col items-center gap-1 text-center text-[12px] font-medium"
              style={{ left: `${(group.center / chartWidth) * 100}%`, bottom: 10 }}
            >
              {grouping.caption ? (
                <span className="whitespace-nowrap">{grouping.caption(group.bars[0].plan)}</span>
              ) : (
                <>
                  {group.bars[0].plan.company && (
                    <CompanyLogo company={group.bars[0].plan.company} size="sm" decorative />
                  )}
                  <span className="whitespace-nowrap">{group.bars[0].plan.providerName}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {hoveredBar && (
        <ChartTooltip x={Math.min(hoveredBar.cx, width - 20)} y={y(hoveredBar.value)} width={width}>
          <TooltipHeader plan={hoveredBar.plan} />
          {hoveredBar.plan.region && <TooltipRow label="Region" value={hoveredBar.plan.region} />}
          <TooltipRow
            label="P50"
            value={`${format(hoveredBar.value)}${accessor.unit ? ` ${accessor.unit}` : ""}`}
          />
          {hoveredBar.range && (
            <TooltipRow label="P10 – P90" value={`${format(hoveredBar.range[0])} – ${format(hoveredBar.range[1])}`} />
          )}
          {hoveredBar.plan.priceMonth !== undefined && (
            <TooltipRow label="Price / month" value={priceLabel(hoveredBar.plan)} />
          )}
          <TooltipRow label="Fresh hosts" value={hoveredBar.plan.hostCount} />
          {!hoveredBar.plan.rankEligible && <p className="mt-1 text-subtle">Provisional · not ranked yet</p>}
        </ChartTooltip>
      )}
    </div>
  );
}
