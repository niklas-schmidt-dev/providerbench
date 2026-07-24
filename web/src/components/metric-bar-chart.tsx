"use client";

import { Bar, BarChart, Cell, ErrorBar, LabelList, XAxis, YAxis } from "recharts";

import {
  ChartCommand,
  ChartMethodology,
  ChartWatermark,
} from "@/components/chart-frame";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getCompany } from "@/lib/companies";
import { formatMetricValue } from "@/lib/format";
import { formatMeasurementWindow } from "@/lib/dates";
import { getProvider } from "@/lib/providers";
import type { BarDatum } from "@/lib/series";

const PLOT_HEIGHT = 232;
const TICK_HEIGHT = 68;

type ColumnDatum = BarDatum & {
  fill: string;
  fillOpacity: number;
  // ErrorBar deltas relative to the P50 headline: down to P10, up to P90.
  // Absent when the distribution has no spread — a zero-length whisker would
  // render stray cap marks.
  whisker?: [number, number];
  // The label carries its own datum because Recharts re-indexes labels when a
  // bar degenerates to zero height — a positional index would point at the
  // wrong column.
  valueLabel: { text: string; value: number; whiskerUp: number };
};

type TickProps = {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
};

// Column footer in the artificialanalysis.ai manner: logo chip, then the plan
// and region as two quiet lines. Identity never rides on color alone.
function ColumnTick({ x, y, payload, data }: TickProps & { data: Map<string, ColumnDatum> }) {
  const datum = payload?.value != null ? data.get(String(payload.value)) : undefined;
  if (x == null || y == null || !datum) return null;

  const provider = getProvider(datum.provider);
  const company = provider.company ? getCompany(provider.company) : undefined;
  const wordmark = company?.logoKind === "wordmark";
  const chipWidth = wordmark ? 42 : 22;
  const darkSurface = company?.logoSurface === "dark";
  const line1 = datum.plan ?? provider.name;
  const line2 = datum.region?.toUpperCase();

  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        x={-chipWidth / 2}
        y={7}
        width={chipWidth}
        height={22}
        rx={5}
        fill={darkSurface ? "#111318" : "#f7f7f4"}
        stroke={darkSurface ? "rgb(255 255 255 / 0.12)" : "rgb(0 0 0 / 0.1)"}
      />
      {company ? (
        <image
          href={company.logoPath}
          x={wordmark ? -17 : -7}
          y={wordmark ? 12 : 11}
          width={wordmark ? 34 : 14}
          height={wordmark ? 12 : 14}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : (
        <text
          y={22}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="var(--muted-foreground)"
        >
          {provider.name.slice(0, 1).toUpperCase()}
        </text>
      )}
      <text y={46} textAnchor="middle" fontSize={10.5} fill="var(--foreground)" fillOpacity={0.85}>
        {line1.length > 16 ? `${line1.slice(0, 15)}…` : line1}
      </text>
      {line2 && (
        <text
          y={60}
          textAnchor="middle"
          fontSize={9}
          fontFamily="var(--font-mono)"
          fill="var(--muted-foreground)"
        >
          {line2}
        </text>
      )}
    </g>
  );
}

type ValueLabelProps = {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: unknown;
};

export function MetricBarChart({
  title,
  unit,
  higherIsBetter,
  data,
  description,
  sourceHref,
  command,
  anchorId,
  note,
}: {
  title: string;
  unit: string;
  higherIsBetter: boolean;
  data: BarDatum[];
  description?: string;
  sourceHref?: string;
  command?: string;
  anchorId?: string;
  note?: string;
}) {
  const sorted = [...data].sort((a, b) =>
    higherIsBetter ? b.value - a.value : a.value - b.value,
  );
  const chartData: ColumnDatum[] = sorted.map((d) => {
    const down = Math.max(0, d.value - d.distribution.p10);
    const up = Math.max(0, d.distribution.p90 - d.value);
    return {
      ...d,
      sample: d.sample ?? false,
      fill: `var(--color-${d.id})`,
      fillOpacity: d.rankEligible ? 0.95 : 0.45,
      whisker: down > 0 || up > 0 ? [down, up] : undefined,
      valueLabel: { text: formatMetricValue(d.value), value: d.value, whiskerUp: up },
    };
  });
  const config = Object.fromEntries(
    sorted.map((d) => [d.id, { label: d.label, color: getProvider(d.provider).color }]),
  ) satisfies ChartConfig;
  const tickData = new Map(chartData.map((d) => [d.id, d]));
  const yMax = Math.max(
    ...chartData.map((d) => Math.max(d.value, d.distribution.p90)),
  );

  // Value printed on the column, artificialanalysis.ai-style. Tall columns
  // carry it inside; short ones lift it above their own P90 whisker cap.
  const renderValueLabel = (props: ValueLabelProps) => {
    const x = Number(props.x);
    const y = Number(props.y);
    const width = Number(props.width);
    const height = Number(props.height);
    const info = props.value as ColumnDatum["valueLabel"] | undefined;
    if (!info || Number.isNaN(x)) return <g />;
    const inside = height >= 34;
    let labelY = y + height / 2 + 4;
    if (!inside) {
      const pxPerUnit = info.value > 0 && height > 0 ? height / info.value : 0;
      labelY = y - info.whiskerUp * pxPerUnit - 6;
    }
    return (
      <text
        x={x + width / 2}
        y={labelY}
        textAnchor="middle"
        fontSize={11.5}
        fontWeight={600}
        fontFamily="var(--font-mono)"
        fill={inside ? "#fff" : "var(--foreground)"}
      >
        {info.text}
      </text>
    );
  };

  return (
    <Card id={anchorId} className="scroll-mt-20 gap-0 overflow-hidden py-0">
      <CardHeader className="gap-1 px-5 pt-4 pb-1">
        <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>
        <p className="text-[11.5px] text-muted-foreground">
          Cross-host P50 · {unit} · {higherIsBetter ? "higher" : "lower"} is
          better · whiskers span P10–P90
        </p>
      </CardHeader>
      <CardContent className="relative px-3 pb-2 sm:px-4">
        <ChartWatermark className="top-1 right-4" />
        <ChartContainer
          config={config}
          className="w-full"
          style={{ height: PLOT_HEIGHT + TICK_HEIGHT }}
        >
          <BarChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 22, right: 8, bottom: 0, left: 8 }}
            barCategoryGap="22%"
            maxBarSize={64}
          >
            <XAxis
              dataKey="id"
              interval={0}
              tickLine={false}
              axisLine={false}
              height={TICK_HEIGHT}
              tick={<ColumnTick data={tickData} />}
            />
            <YAxis hide domain={[0, yMax]} />
            <ChartTooltip
              cursor={{ fill: "color-mix(in oklab, var(--foreground) 5%, transparent)" }}
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="id"
                  formatter={(value, _name, item) => (
                    <span className="flex w-full items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: item?.payload?.fill }}
                      />
                      <span className="text-muted-foreground">
                        {item?.payload?.label}
                        {item?.payload?.product ? ` · ${item.payload.product}` : ""}
                        {item?.payload?.region ? ` · ${item.payload.region}` : ""}
                        {item?.payload?.sample ? " · sample" : ""}
                      </span>
                      <span className="ml-auto grid grid-cols-[auto_auto] gap-x-2 font-mono text-[11px] tabular-nums">
                        <span className="text-muted-foreground">P50</span>
                        <span className="text-right text-foreground">
                          {formatMetricValue(Number(value))} {unit}
                        </span>
                        <span className="text-muted-foreground">mean</span>
                        <span className="text-right">
                          {formatMetricValue(item?.payload?.distribution?.mean)} {unit}
                        </span>
                        <span className="text-muted-foreground">P10 / P90</span>
                        <span className="text-right">
                          {formatMetricValue(item?.payload?.distribution?.p10)} /{" "}
                          {formatMetricValue(item?.payload?.distribution?.p90)}
                        </span>
                        <span className="text-muted-foreground">P99</span>
                        <span className="text-right">
                          {formatMetricValue(item?.payload?.distribution?.p99)}
                        </span>
                        <span className="text-muted-foreground">hosts</span>
                        <span className="text-right">
                          {item?.payload?.hostCount}
                          {!item?.payload?.rankEligible ? " · provisional" : ""}
                        </span>
                        <span className="text-muted-foreground">measured</span>
                        <span className="text-right">
                          {formatMeasurementWindow(
                            item?.payload?.measuredFrom,
                            item?.payload?.measuredTo,
                          )}
                        </span>
                        <span className="text-muted-foreground">cohort</span>
                        <span className="text-right">
                          {item?.payload?.cohortId}
                        </span>
                      </span>
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} minPointSize={2} isAnimationActive>
              {chartData.map((entry) => (
                <Cell
                  key={entry.id}
                  fill={entry.fill}
                  fillOpacity={entry.fillOpacity}
                />
              ))}
              <LabelList dataKey="valueLabel" content={renderValueLabel} />
              <ErrorBar
                dataKey="whisker"
                direction="y"
                width={5}
                strokeWidth={1}
                stroke="color-mix(in oklab, var(--foreground) 55%, transparent)"
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        {note && (
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-muted-foreground">
            {note}
          </p>
        )}
        {chartData.some((item) => !item.rankEligible) && (
          <p className="px-2 pb-1 text-[11px] leading-relaxed text-warning">
            Faded columns are provisional: fewer than 10 independent fresh hosts.
          </p>
        )}
      </CardContent>
      {description && (
        <ChartMethodology description={description} sourceHref={sourceHref} />
      )}
      {command && <ChartCommand command={command} />}
    </Card>
  );
}
