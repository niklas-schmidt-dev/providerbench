import Link from "next/link";

import { DsBadge } from "@/components/ds/badge";
import { DistributionBar } from "@/components/ds/distribution-bar";
import { ProviderMark } from "@/components/ds/provider-mark";
import { ScoreCell } from "@/components/ds/score-cell";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue, planCpuParts } from "@/lib/format";
import { getMetricDef } from "@/lib/metrics";
import { getProvider, providerColor, providerLabel } from "@/lib/providers";
import type { MetricRef } from "@/lib/report";
import { cn } from "@/lib/utils";

// The board: rank, identity, price, spotlight measurements, the spread of the
// lead metric on a shared scale, and the composite score as a ramp chip.
// Ranked cohorts first; provisional campaigns follow faded, never interleaved.
export function Leaderboard({
  groups,
  spotlight,
}: {
  groups: ScoredGroup[];
  spotlight: MetricRef[];
}) {
  const ranked = groups
    .filter((group) => group.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const provisional = groups
    .filter((group) => !group.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const ordered = [...ranked, ...provisional];
  const spotlights = spotlight.map((ref) => ({
    ref,
    def: getMetricDef(ref.test, ref.metric),
  }));

  // Shared spread scale: the lead spotlight metric across every row.
  const spreadRef = spotlight[0];
  const spreadDomain = Math.max(
    ...ordered.map(
      (group) =>
        metricSummary(group, spreadRef.test, spreadRef.metric)?.distribution.p99 ?? 0,
    ),
    1,
  );

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            {[
              { label: "#", align: "left", width: 40 },
              { label: "Provider / plan", align: "left", width: 280 },
              { label: "€ / mo", align: "right" },
              ...spotlights.map((s) => ({
                label: s.ref.shortLabel ?? s.def?.title ?? s.ref.metric,
                align: "right" as const,
              })),
              {
                label: `${spreadRef.shortLabel ?? ""} p10 → p90 spread`,
                align: "left",
                width: 190,
              },
              { label: "Evidence", align: "right" },
              { label: "Value", align: "right" },
              { label: "Score", align: "right" },
            ].map((c) => (
              <th
                key={c.label}
                className="pb-label h-[34px] border-b border-(--border-strong) bg-card px-(--pad-cell-x) whitespace-nowrap text-muted-foreground"
                style={{ textAlign: c.align as "left" | "right", width: "width" in c ? c.width : undefined }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((group, index) => {
            const name = group.provider.name ?? group.id;
            const provider = getProvider(name);
            const color = providerColor(name);
            const isRanked = group.rankEligible;
            const { tier, cpu } = planCpuParts(group.provider.tier, group.system.cpu_cores);
            const planLine = [group.provider.product, group.provider.plan, tier, group.provider.region, cpu]
              .filter(Boolean)
              .join(" · ");
            const spread = metricSummary(group, spreadRef.test, spreadRef.metric)?.distribution;

            return (
              <tr
                key={group.id}
                className={cn(
                  "h-14 border-b border-(--border-hairline) transition-colors last:border-b-0 hover:bg-(--surface-hover)",
                  !isRanked && "opacity-60",
                )}
              >
                <td className="pb-num px-(--pad-cell-x) text-[13px] text-muted-foreground">
                  {isRanked ? index + 1 : "··"}
                </td>
                <td className="px-(--pad-cell-x)">
                  <span className="flex items-center gap-2">
                    <Link href={`/providers/${name}`} className="min-w-0 hover:underline">
                      <ProviderMark
                        name={providerLabel(name)}
                        color={color}
                        company={provider.company}
                        meta={planLine}
                      />
                    </Link>
                    {group.sample && <DsBadge tone="warn">Sample</DsBadge>}
                    {!isRanked && !group.sample && (
                      <DsBadge tone="warn">Provisional</DsBadge>
                    )}
                  </span>
                </td>
                <td className="pb-num px-(--pad-cell-x) text-right text-[13px] text-foreground">
                  {group.provider.price_eur_month
                    ? group.provider.price_eur_month.toFixed(2)
                    : "—"}
                </td>
                {spotlights.map(({ ref, def }) => {
                  const summary = metricSummary(group, ref.test, ref.metric);
                  return (
                    <td
                      key={`${ref.test}.${ref.metric}`}
                      className="pb-num px-(--pad-cell-x) text-right text-[13px] whitespace-nowrap"
                      title={
                        summary
                          ? `p10 ${formatMetricValue(summary.distribution.p10)} · p50 ${formatMetricValue(summary.distribution.p50)} · p90 ${formatMetricValue(summary.distribution.p90)} ${summary.unit}`
                          : undefined
                      }
                    >
                      {summary ? (
                        <>
                          <span className="text-foreground">
                            {formatMetricValue(summary.distribution.p50)}
                          </span>{" "}
                          <span className="text-[11px] text-(--text-faint)">
                            {def?.unit ?? summary.unit}
                          </span>
                        </>
                      ) : (
                        <span className="text-(--text-faint)">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-(--pad-cell-x)">
                  {spread ? (
                    <DistributionBar
                      p50={spread.p50}
                      bandLo={spread.p10}
                      bandHi={spread.p90}
                      domainMax={spreadDomain}
                      color={color}
                    />
                  ) : (
                    <span className="text-(--text-faint)">—</span>
                  )}
                </td>
                <td
                  className="pb-num px-(--pad-cell-x) text-right text-[12px] whitespace-nowrap text-muted-foreground"
                  title={`measured ${formatMeasurementWindow(group.measuredFrom, group.measuredTo)}`}
                >
                  {group.hostCount}h · {group.runCount}r
                </td>
                <td className="pb-num px-(--pad-cell-x) text-right text-[13px] text-muted-foreground">
                  {group.valueIndex?.toFixed(1) ?? "—"}
                </td>
                <td className="px-(--pad-cell-x) text-right">
                  <ScoreCell value={Math.round(group.performanceScore)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
