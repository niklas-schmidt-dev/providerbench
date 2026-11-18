import { ChartCommand, ChartMethodology } from "@/components/chart-frame";
import { DsBadge } from "@/components/ds/badge";
import { DsCard } from "@/components/ds/card";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue } from "@/lib/format";
import { getProvider } from "@/lib/providers";
import type { BarDatum } from "@/lib/series";

// One metric, every provider: ranked horizontal bars to the cross-host P50 in
// the provider's series color, with the P10–P90 band and the P99 tail marked
// on the same shared scale. The tails are the product, not an embarrassment.
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
  const domainMax =
    Math.max(
      ...sorted.map((d) => Math.max(d.value, d.distribution.p90, d.distribution.p99)),
      1,
    ) * 1.02;
  const x = (v: number) => `${Math.min(100, Math.max(0, (v / domainMax) * 100))}%`;
  const hasProvisional = sorted.some((d) => !d.rankEligible);

  return (
    <DsCard
      id={anchorId}
      className="scroll-mt-24"
      title={title}
      actions={
        <span className="pb-label hidden text-(--text-faint) sm:block">
          {higherIsBetter ? "higher is better" : "lower is better"}
        </span>
      }
      subtitle={`Cross-host P50 · ${unit} · band spans P10–P90, tick marks P99`}
      footer={
        (description || command) && (
          <div className="-mx-4 -my-3">
            {description && (
              <ChartMethodology description={description} sourceHref={sourceHref} />
            )}
            {command && <ChartCommand command={command} />}
          </div>
        )
      }
    >
      <div className="grid gap-3 pt-2">
        {sorted.map((d, i) => {
          const isBest = i === 0;
          const color = getProvider(d.provider).color;
          const detail = [d.plan, d.region].filter(Boolean).join(" · ");
          return (
            <div
              key={d.id}
              className="grid items-center gap-3"
              style={{ gridTemplateColumns: "minmax(0,148px) minmax(90px,1fr) auto" }}
              title={`${d.label}${detail ? ` · ${detail}` : ""} — P50 ${formatMetricValue(d.value)} ${unit} · mean ${formatMetricValue(d.distribution.mean)} · P10 ${formatMetricValue(d.distribution.p10)} · P90 ${formatMetricValue(d.distribution.p90)} · P99 ${formatMetricValue(d.distribution.p99)} · ${d.hostCount} hosts · measured ${formatMeasurementWindow(d.measuredFrom, d.measuredTo)}`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 truncate text-[13px] tracking-[-0.005em] text-(--text-body)">
                  {d.label}
                  {d.sample && <DsBadge tone="warn">Sample</DsBadge>}
                </span>
                {detail && (
                  <span className="block truncate font-mono text-[10.5px] text-(--text-faint)">
                    {detail}
                  </span>
                )}
              </span>
              <span className="relative h-[18px]">
                <span className="absolute inset-x-0 top-[4px] h-(--chart-bar-height) rounded-[2px] bg-(--bar-track)" />
                <span
                  className="absolute top-[4px] left-0 h-(--chart-bar-height) rounded-[2px]"
                  style={{
                    width: x(d.value),
                    background: color,
                    opacity: d.rankEligible ? 1 : 0.4,
                    transition: "var(--transition-bar)",
                  }}
                />
                <span
                  className="absolute top-[7px] h-1 rounded-[1px]"
                  style={{
                    left: x(d.distribution.p10),
                    width: `calc(${x(d.distribution.p90)} - ${x(d.distribution.p10)})`,
                    background: color,
                    opacity: 0.28,
                  }}
                />
                <span
                  className="absolute top-0.5 h-[14px] w-px bg-(--annotation)"
                  style={{ left: x(d.distribution.p99) }}
                />
              </span>
              <span
                className="pb-num min-w-[64px] text-right text-[13px]"
                style={{
                  color: isBest ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: isBest ? 500 : 400,
                }}
              >
                {formatMetricValue(d.value)}
                <span className="text-[11px] text-(--text-faint)"> {unit}</span>
              </span>
            </div>
          );
        })}
      </div>
      {note && (
        <p className="mt-4 text-[12px] leading-[17px] text-muted-foreground">{note}</p>
      )}
      {hasProvisional && (
        <p className="pb-label mt-3 text-[10px] text-warning">
          Faded bars are provisional under the validator-owned cohort contract
        </p>
      )}
    </DsCard>
  );
}
