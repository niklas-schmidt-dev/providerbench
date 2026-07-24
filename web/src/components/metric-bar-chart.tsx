"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import { CopyButton } from "@/components/copy-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMetricValue } from "@/lib/format";
import { providerColor } from "@/lib/providers";
import type { BarDatum } from "@/lib/series";

const ROW_HEIGHT = 34;

// Horizontal comparison bars on the shadcn chart component (Recharts v3).
// One bar per run; color follows the provider entity, so two plans from the
// same provider share a hue and are told apart by their labels.
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
  const labelOf = new Map(sorted.map((d) => [d.id, d.label]));
  const chartData = sorted.map((d) => ({
    ...d,
    sample: d.sample ?? false,
    fill: `var(--color-${d.id})`,
  }));
  const config = Object.fromEntries(
    sorted.map((d) => [d.id, { label: d.label, color: providerColor(d.provider) }]),
  ) satisfies ChartConfig;

  return (
    <Card id={anchorId} className="scroll-mt-20 gap-4 py-5">
      <CardHeader className="gap-2 px-5">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {unit} · {higherIsBetter ? "higher = better" : "lower = better"}
          </span>
        </div>
        {description && (
          <p className="max-w-prose text-[12.5px] leading-relaxed text-muted-foreground">
            {description}
            {sourceHref && (
              <>
                {" "}
                <a href={sourceHref} className="text-brand hover:underline">
                  source →
                </a>
              </>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-5">
        <ChartContainer
          config={config}
          className="w-full"
          style={{ height: chartData.length * ROW_HEIGHT + 8 }}
        >
          <BarChart
            accessibilityLayer
            layout="vertical"
            data={chartData}
            margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
            barSize={18}
          >
            <YAxis
              type="category"
              dataKey="id"
              tickLine={false}
              axisLine={false}
              width={132}
              tick={{ fontSize: 12 }}
              className="[&_text]:fill-muted-foreground"
              tickFormatter={(id: string) => labelOf.get(id) ?? id}
            />
            <XAxis type="number" hide domain={[0, "dataMax"]} />
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
                        {item?.payload?.sample ? " · sample" : ""}
                      </span>
                      <span className="ml-auto font-mono tabular-nums text-foreground">
                        {formatMetricValue(Number(value))} {unit}
                      </span>
                    </span>
                  )}
                />
              }
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
              <LabelList
                dataKey="value"
                position="right"
                offset={8}
                formatter={(v: unknown) => formatMetricValue(Number(v))}
                className="fill-foreground font-mono"
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        {note && (
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">{note}</p>
        )}
        {command && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border bg-background py-1 pr-1 pl-3">
            <code className="truncate font-mono text-[12px] text-muted-foreground">
              <span aria-hidden className="select-none text-muted-foreground/60">
                ${" "}
              </span>
              {command}
            </code>
            <CopyButton text={command} label={`Copy command: ${command}`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
