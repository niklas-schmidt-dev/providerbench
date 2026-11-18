import Link from "next/link";

import { DsBadge } from "@/components/ds/badge";
import { ProviderMark } from "@/components/ds/provider-mark";
import { ScoreCell } from "@/components/ds/score-cell";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { planCpuParts } from "@/lib/format";
import { getProvider, providerColor, providerLabel } from "@/lib/providers";
import type { TableColumn } from "@/lib/report";
import { cn } from "@/lib/utils";

// Columns arrive resolved from the category's report spec (lib/report.ts) —
// the ledger renders any benchmark suite, not one hardcoded set of metrics.

function planLine(group: ScoredGroup): string {
  const { tier, cpu } = planCpuParts(group.provider.tier, group.system.cpu_cores);
  return [group.provider.product, group.provider.plan, tier, group.provider.region, cpu]
    .filter(Boolean)
    .join(" · ");
}

export function ComparisonTable({
  groups,
  columns,
}: {
  groups: ScoredGroup[];
  columns: TableColumn[];
}) {
  // The ledger reads as a ranking: ranked cohorts first by composite score,
  // provisional campaigns after the fold — visible, never interleaved.
  const ranked = groups
    .filter((group) => group.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const provisional = groups
    .filter((group) => !group.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const ordered = [...ranked, ...provisional];

  const bests = columns.map((c) => {
    const values = groups
      .map((group) => metricSummary(group, c.test, c.metric)?.distribution.p50)
      .filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return c.higherIsBetter ? Math.max(...values) : Math.min(...values);
  });

  let rank = 0;

  return (
    <div className="overflow-x-auto rounded-md border border-(--border-hairline) bg-card shadow-(--shadow-xs)">
      <table className="w-full min-w-[1280px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="pb-label h-11 border-b border-(--border-strong) pl-4 text-left text-muted-foreground">
              #
            </th>
            <th className="pb-label h-11 border-b border-(--border-strong) px-(--pad-cell-x) text-left text-muted-foreground">
              Provider / plan
            </th>
            <th className="h-11 border-b border-(--border-strong) px-(--pad-cell-x) text-right">
              <span className="pb-label block text-muted-foreground">€ / mo</span>
            </th>
            <th className="h-11 border-b border-(--border-strong) px-(--pad-cell-x) text-right">
              <span className="pb-label block text-muted-foreground">Score</span>
              <span className="block font-mono text-[9px] font-normal text-(--text-faint)">
                0–100
              </span>
            </th>
            <th className="h-11 border-b border-(--border-strong) px-(--pad-cell-x) text-right">
              <span className="pb-label block text-muted-foreground">Value</span>
              <span className="block font-mono text-[9px] font-normal text-(--text-faint)">
                index
              </span>
            </th>
            {columns.map((c) => (
              <th
                key={c.metric}
                className="h-11 border-b border-(--border-strong) px-(--pad-cell-x) text-right"
              >
                <span className="pb-label block text-muted-foreground">{c.label}</span>
                <span className="block font-mono text-[9px] font-normal text-(--text-faint)">
                  {c.unit}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((group) => {
            const name = group.provider.name ?? group.id;
            const provider = getProvider(name);
            const isRanked = group.rankEligible;
            if (isRanked) rank += 1;
            return (
              <tr
                key={group.id}
                className={cn(
                  "border-b border-(--border-hairline) transition-colors last:border-b-0 hover:bg-(--surface-hover)",
                  !isRanked && "opacity-60",
                )}
              >
                <td className="pb-num py-3 pl-4 text-[13px] text-muted-foreground">
                  {isRanked ? rank : "··"}
                </td>
                <td className="px-(--pad-cell-x) py-3">
                  <span className="flex items-center gap-2">
                    <Link href={`/providers/${name}`} className="min-w-0 hover:underline">
                      <ProviderMark
                        name={providerLabel(name)}
                        color={providerColor(name)}
                        company={provider.company}
                        meta={planLine(group)}
                      />
                    </Link>
                    {group.sample && <DsBadge tone="warn">Sample</DsBadge>}
                    {!isRanked && !group.sample && (
                      <DsBadge tone="warn">Provisional</DsBadge>
                    )}
                  </span>
                  <span className="mt-1 block font-mono text-[9.5px] text-(--text-faint)">
                    {group.hostCount} host{group.hostCount === 1 ? "" : "s"} ·{" "}
                    {group.runCount} run{group.runCount === 1 ? "" : "s"} ·{" "}
                    {group.protocolVersion} · {group.profile} · measured{" "}
                    {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
                  </span>
                </td>
                <td className="pb-num px-(--pad-cell-x) text-right text-[13px] whitespace-nowrap text-foreground">
                  <span className="block">
                    {group.provider.price_eur_month
                      ? group.provider.price_eur_month.toFixed(2)
                      : "—"}
                  </span>
                  {group.provider.price_eur_hour ? (
                    <span className="block text-[9.5px] text-(--text-faint)">
                      {group.provider.price_eur_hour.toFixed(4)}/h
                    </span>
                  ) : null}
                </td>
                <td className="px-(--pad-cell-x) text-right">
                  <ScoreCell size="sm" value={Math.round(group.performanceScore)} />
                </td>
                <td className="pb-num px-(--pad-cell-x) text-right text-[13px] text-muted-foreground">
                  {group.valueIndex?.toFixed(1) ?? "—"}
                </td>
                {columns.map((c, i) => {
                  const summary = metricSummary(group, c.test, c.metric);
                  const distribution = summary?.distribution;
                  const isBest =
                    distribution !== undefined && distribution.p50 === bests[i];
                  return (
                    <td
                      key={c.metric}
                      className="pb-num px-(--pad-cell-x) text-right text-[12.5px] whitespace-nowrap"
                    >
                      <span
                        className={
                          isBest
                            ? "font-semibold text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {distribution ? c.format(distribution.p50) : "—"}
                      </span>
                      {distribution && (
                        <span
                          className="mt-0.5 block text-[9.5px] text-(--text-faint)"
                          title={`mean ${distribution.mean}; p10 ${distribution.p10}; p90 ${distribution.p90}; p99 ${distribution.p99}`}
                        >
                          {/* Always surface the BAD tail: the slowest hosts
                              for throughput, the worst latencies for delays. */}
                          {c.higherIsBetter ? (
                            <>
                              μ{c.format(distribution.mean)} · p10{" "}
                              {c.format(distribution.p10)}
                            </>
                          ) : (
                            <>
                              μ{c.format(distribution.mean)} · p90{" "}
                              {c.format(distribution.p90)} · p99{" "}
                              {c.format(distribution.p99)}
                            </>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
