"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { ChartWatermark } from "@/components/chart-frame";
import { SectionHeading } from "@/components/section-heading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import {
  formatChartDate,
  formatMeasurementDateTime,
  formatMeasurementWindow,
} from "@/lib/dates";
import { formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";

type HistoryMetric = {
  id: string;
  label: string;
  unit: string;
  value: (group: ScoredGroup) => number | undefined;
};

const HISTORY_METRICS: HistoryMetric[] = [
  {
    id: "performance",
    label: "Composite",
    unit: "index",
    value: (group) => group.performanceScore,
  },
  {
    id: "cpu-multi",
    label: "CPU all-core",
    unit: "MB/s",
    value: (group) =>
      metricSummary(group, "cpu", "multi_core_hash")?.distribution.p50,
  },
  {
    id: "cpu-single",
    label: "CPU 1-core",
    unit: "MB/s",
    value: (group) =>
      metricSummary(group, "cpu", "single_core_hash")?.distribution.p50,
  },
  {
    id: "memory",
    label: "Memory",
    unit: "GB/s",
    value: (group) =>
      metricSummary(group, "memory", "copy_bandwidth")?.distribution.p50,
  },
  {
    id: "disk",
    label: "4K read",
    unit: "IOPS",
    value: (group) =>
      metricSummary(group, "disk", "rand_read_4k")?.distribution.p50,
  },
  {
    id: "network",
    label: "Download",
    unit: "Mbps",
    value: (group) =>
      metricSummary(group, "network", "download")?.distribution.p50,
  },
];

const SERIES_COLORS = [
  "#3987e5",
  "#e66e39",
  "#3db98b",
  "#d5a12c",
  "#d96b9b",
  "#9d7bea",
  "#72a6b8",
  "#d16e68",
];

function seriesLabel(group: ScoredGroup): string {
  return [group.provider.plan, group.provider.region].filter(Boolean).join(" · ");
}

export function PerformanceHistoryChart({
  groups,
}: {
  groups: ScoredGroup[];
}) {
  const [metricId, setMetricId] = useState(HISTORY_METRICS[0].id);
  const metric =
    HISTORY_METRICS.find((candidate) => candidate.id === metricId) ??
    HISTORY_METRICS[0];

  const series = useMemo(() => {
    const bySeries = new Map<string, ScoredGroup[]>();
    for (const group of groups) {
      if (metric.value(group) === undefined) continue;
      bySeries.set(group.seriesId, [
        ...(bySeries.get(group.seriesId) ?? []),
        group,
      ]);
    }
    return [...bySeries.entries()]
      .map(([id, points], index) => ({
        id,
        label: seriesLabel(points[0]),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        points: [...points].sort((a, b) =>
          a.measuredTo.localeCompare(b.measuredTo),
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [groups, metric]);

  const cohortTimestamps = new Map<string, number>();
  for (const group of groups) {
    cohortTimestamps.set(
      group.cohortId,
      Math.max(
        cohortTimestamps.get(group.cohortId) ?? 0,
        Date.parse(group.measuredTo),
      ),
    );
  }
  const rows = new Map<number, Record<string, number | ScoredGroup>>();
  for (const item of series) {
    for (const group of item.points) {
      const timestamp =
        cohortTimestamps.get(group.cohortId) ?? Date.parse(group.measuredTo);
      rows.set(timestamp, {
        ...(rows.get(timestamp) ?? { timestamp }),
        [item.id]: metric.value(group) ?? Number.NaN,
        [`${item.id}__group`]: group,
      });
    }
  }
  const chartData = [...rows.values()].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp),
  );

  const allTimestamps = chartData.map((point) => Number(point.timestamp));
  const uniqueTimestamps = [...new Set(allTimestamps)];
  const minTimestamp = Math.min(...allTimestamps);
  const maxTimestamp = Math.max(...allTimestamps);
  const padding =
    minTimestamp === maxTimestamp
      ? 12 * 60 * 60 * 1000
      : Math.max((maxTimestamp - minTimestamp) * 0.06, 60 * 60 * 1000);
  const cohortCount = new Set(groups.map((group) => group.cohortId)).size;
  const config = Object.fromEntries(
    series.map((item) => [
      item.id,
      { label: item.label, color: item.color },
    ]),
  ) satisfies ChartConfig;

  if (chartData.length === 0) return null;

  return (
    <section className="mt-14">
      <SectionHeading
        title="Performance history"
        description="Every campaign is a separate point in time. Old hardware is retained, never averaged into a newer campaign, so generation changes remain visible."
        meta={
          <Badge variant="outline" className="font-mono text-muted-foreground">
            {cohortCount} dated {cohortCount === 1 ? "cohort" : "cohorts"}
          </Badge>
        }
      />

      <Card className="mt-5 overflow-hidden py-0">
        <div
          className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5"
          aria-label="Historical metric"
          role="group"
        >
          {HISTORY_METRICS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMetricId(option.id)}
              aria-pressed={metric.id === option.id}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[12px] whitespace-nowrap transition-colors",
                metric.id === option.id
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <CardHeader className="gap-2 px-5 pt-4 pb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle className="text-[15px] font-semibold">
              {metric.label} over time
            </CardTitle>
            <span className="font-mono text-[11px] text-muted-foreground">
              P50 per campaign · {metric.unit}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {series.map((item) => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ background: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="relative px-2 py-4 sm:px-5">
          <ChartWatermark className="top-0 right-5" />
          <ChartContainer config={config} className="h-[330px] w-full">
            <LineChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 14, right: 24, bottom: 16, left: 8 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="2 6"
                stroke="color-mix(in oklab, var(--foreground) 10%, transparent)"
              />
              <XAxis
                type="number"
                dataKey="timestamp"
                domain={[minTimestamp - padding, maxTimestamp + padding]}
                scale="time"
                ticks={uniqueTimestamps}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => formatChartDate(Number(value))}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10 }}
                width={52}
                domain={[
                  (minimum: number) => Math.max(0, minimum * 0.9),
                  (maximum: number) => maximum * 1.1,
                ]}
                tickFormatter={(value) => formatMetricValue(Number(value))}
              />
              <ChartTooltip
                cursor={{
                  stroke:
                    "color-mix(in oklab, var(--foreground) 28%, transparent)",
                  strokeDasharray: "3 3",
                }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload.find(
                    (entry) =>
                      entry.value !== undefined && entry.dataKey !== "timestamp",
                  );
                  if (!item || typeof item.dataKey !== "string") return null;
                  const group = item.payload?.[
                    `${item.dataKey}__group`
                  ] as ScoredGroup | undefined;
                  if (!group) return null;
                  const line = series.find(
                    (candidate) => candidate.id === item.dataKey,
                  );
                  return (
                    <div className="min-w-64 rounded-lg border bg-background px-3 py-2.5 text-xs shadow-xl">
                      <p className="font-medium text-foreground">
                        {line?.label}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-brand">
                        {formatMeasurementDateTime(group.measuredTo)}
                      </p>
                      <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">{metric.label}</dt>
                        <dd className="text-right font-mono">
                          {formatMetricValue(Number(item.value))} {metric.unit}
                        </dd>
                        <dt className="text-muted-foreground">CPU</dt>
                        <dd
                          className="max-w-48 truncate text-right font-mono text-[10px]"
                          title={group.system.cpu_model}
                        >
                          {group.system.cpu_model || "—"}
                        </dd>
                        <dt className="text-muted-foreground">Evidence</dt>
                        <dd className="text-right font-mono">
                          {group.hostCount} hosts
                        </dd>
                        <dt className="text-muted-foreground">Cohort</dt>
                        <dd className="text-right font-mono text-[10px]">
                          {group.cohortId}
                        </dd>
                      </dl>
                    </div>
                  );
                }}
              />
              {series.map((item) => (
                <Line
                  key={item.id}
                  type="linear"
                  dataKey={item.id}
                  name={item.label}
                  stroke={item.color}
                  strokeWidth={2}
                  connectNulls
                  dot={{ r: 3.5, fill: item.color, stroke: "var(--card)", strokeWidth: 1.5 }}
                  activeDot={{ r: 5.5, fill: item.color, strokeWidth: 0 }}
                  isAnimationActive
                />
              ))}
            </LineChart>
          </ChartContainer>
          <p className="px-3 pt-1 text-[11px] text-muted-foreground">
            The first campaign is the baseline. A trend appears after the same
            plan and region are measured again under a new campaign ID.
          </p>
        </CardContent>
      </Card>

      <div className="mt-3 overflow-hidden rounded-xl border bg-card">
        <div className="grid grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(12rem,2fr)_auto] gap-3 border-b px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          <span>Measured</span>
          <span>Plan / region</span>
          <span>Hardware observed</span>
          <span className="text-right">Evidence</span>
        </div>
        {[...groups]
          .sort((a, b) => b.measuredTo.localeCompare(a.measuredTo))
          .map((group) => (
            <div
              key={group.id}
              className="grid grid-cols-[minmax(9rem,1fr)_minmax(8rem,1fr)_minmax(12rem,2fr)_auto] gap-3 border-b px-4 py-2.5 text-[11px] last:border-b-0"
            >
              <span
                className="font-mono text-foreground"
                title={`${formatMeasurementDateTime(group.measuredFrom)}–${formatMeasurementDateTime(group.measuredTo)}`}
              >
                {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
              </span>
              <span className="font-mono text-muted-foreground">
                {seriesLabel(group)}
              </span>
              <span
                className="truncate font-mono text-muted-foreground"
                title={group.system.cpu_model}
              >
                {group.system.cpu_model || "—"}
              </span>
              <span className="text-right font-mono text-muted-foreground">
                {group.hostCount} hosts
              </span>
            </div>
          ))}
      </div>
    </section>
  );
}
