import Link from "next/link";

import { DsBadge } from "@/components/ds/badge";
import { ScoreCell } from "@/components/ds/score-cell";
import type { ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { getProvider, providerColor, providerLabel } from "@/lib/providers";

// The evidence trail: every ranked number exists as a dated, raw JSON
// report. Newest cohorts first; each row links its representative file in
// the public dataset.
export function CohortLedger({
  groups,
  limit = 8,
}: {
  groups: ScoredGroup[];
  limit?: number;
}) {
  const cohorts = [...groups]
    .sort((a, b) => b.measuredTo.localeCompare(a.measuredTo))
    .slice(0, limit);
  if (cohorts.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-md border border-(--border-hairline) bg-card shadow-(--shadow-xs)">
      <table className="w-full min-w-[880px] border-collapse text-[13px]">
        <thead>
          <tr>
            {["Cohort", "Provider / plan", "Evidence", "Score", "Measured", "Raw report"].map(
              (label, i) => (
                <th
                  key={label}
                  className="pb-label h-[34px] border-b border-(--border-strong) px-(--pad-cell-x) whitespace-nowrap text-muted-foreground"
                  style={{ textAlign: i >= 2 && i !== 4 ? "right" : "left" }}
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((group) => {
            const name = group.provider.name ?? group.id;
            const provider = getProvider(name);
            return (
              <tr
                key={group.id}
                className="h-11 border-b border-(--border-hairline) transition-colors last:border-b-0 hover:bg-(--surface-hover)"
              >
                <td
                  className="max-w-[220px] truncate px-(--pad-cell-x) font-mono text-[12px] text-foreground"
                  title={group.cohortId}
                >
                  {group.cohortId}
                </td>
                <td className="px-(--pad-cell-x) whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: providerColor(name) }}
                    />
                    <span className="text-(--text-body)">
                      {providerLabel(name)} · {group.provider.plan} ·{" "}
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {group.provider.region}
                      </span>
                    </span>
                    {!group.rankEligible && <DsBadge tone="warn">provisional</DsBadge>}
                  </span>
                </td>
                <td className="pb-num px-(--pad-cell-x) text-right text-[12px] whitespace-nowrap text-muted-foreground">
                  {group.hostCount}h · {group.runCount}r
                </td>
                <td className="px-(--pad-cell-x) text-right">
                  <ScoreCell size="sm" value={Math.round(group.performanceScore)} />
                </td>
                <td className="pb-num px-(--pad-cell-x) text-[12px] whitespace-nowrap text-muted-foreground">
                  {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
                </td>
                <td className="px-(--pad-cell-x) text-right font-mono text-[11px] whitespace-nowrap">
                  <a
                    href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${group.representative.slug}.json`}
                    className="border-b border-(--border-strong) text-foreground hover:border-foreground"
                  >
                    .json ↗
                  </a>
                  {" · "}
                  <Link
                    href={`/providers/${name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {provider.slug}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
