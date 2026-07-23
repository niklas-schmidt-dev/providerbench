"use client";

import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatMetricValue } from "@/lib/format";
import { providerColor, providerLabel } from "@/lib/providers";

export type BarDatum = {
  provider: string;
  plan?: string;
  value: number;
  sample?: boolean;
};

const ROW_HEIGHT = 30;

// Horizontal provider comparison built on the shadcn chart component
// (Recharts v3). Marks follow the dataviz spec: thin bars, 4px rounded
// data-end, square baseline, value labels in text tokens.
export function MetricBarChart({
  title,
  unit,
  higherIsBetter,
  data,
  note,
}: {
  title: string;
  unit: string;
  higherIsBetter: boolean;
  data: BarDatum[];
  note?: string;
}) {
  const sorted = [...data].sort((a, b) =>
    higherIsBetter ? b.value - a.value : a.value - b.value,
  );
  const chartData = sorted.map((d) => ({
    provider: d.provider,
    plan: d.plan,
    value: d.value,
    sample: d.sample ?? false,
    fill: `var(--color-${d.provider})`,
  }));
  const config = Object.fromEntries(
    sorted.map((d) => [
      d.provider,
      { label: providerLabel(d.provider), color: providerColor(d.provider) },
    ]),
  ) satisfies ChartConfig;

  return (
    <Card className="gap-3 py-4">
        <CardHeader className="flex items-baseline justify-between gap-3 px-4">
          <CardTitle className="text-[13px] font-medium">{title}</CardTitle>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {unit} · {higherIsBetter ? "higher = better" : "lower = better"}
          </span>
        </CardHeader>
        <CardContent className="px-4">
          <ChartContainer
            config={config}
            className="w-full"
            style={{ height: chartData.length * ROW_HEIGHT + 6 }}
          >
            <BarChart
              accessibilityLayer
              layout="vertical"
              data={chartData}
              margin={{ top: 0, right: 48, bottom: 0, left: 0 }}
              barSize={16}
            >
              <YAxis
                type="category"
                dataKey="provider"
                tickLine={false}
                axisLine={false}
                width={100}
                tick={{ fontSize: 11 }}
                className="[&_text]:fill-muted-foreground"
                tickFormatter={(v: string) => providerLabel(v)}
              />
              <XAxis type="number" hide domain={[0, "dataMax"]} />
              <ChartTooltip
                cursor={{ fill: "oklch(1 0 0 / 4%)" }}
                content={
                  <ChartTooltipContent
                    hideLabel
                    nameKey="provider"
                    formatter={(value, name, item) => (
                      <span className="flex w-full items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-[2px]"
                          style={{ background: item?.payload?.fill }}
                        />
                        <span className="text-muted-foreground">
                          {providerLabel(String(name))}
                          {item?.payload?.plan ? ` · ${item.payload.plan}` : ""}
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
                  fontSize={11}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
          {note && (
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
          )}
        </CardContent>
      </Card>
  );
}
