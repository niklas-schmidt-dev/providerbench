import Link from "next/link";

import { DsBadge } from "@/components/ds/badge";
import { DsCard } from "@/components/ds/card";
import { ProviderMark } from "@/components/ds/provider-mark";
import { ScoreCell } from "@/components/ds/score-cell";
import type { ScoredGroup } from "@/lib/aggregate";
import { planCpuParts } from "@/lib/format";
import { getProvider, providerColor, providerLabel } from "@/lib/providers";
import { cn } from "@/lib/utils";

// Work per €100: the composite score per euro of monthly list price,
// normalized to the best-value plan = 100. The point is the COMBINATION —
// neither the raw price column nor the raw score answers "what does my money
// actually buy?". Each row also states the tweet-style argument explicitly:
// how many times more you pay vs. how much more work you get.
export function ValueChart({ groups }: { groups: ScoredGroup[] }) {
  const priced = groups.filter(
    (group): group is ScoredGroup & { valueIndex: number } =>
      group.valueIndex !== undefined &&
      Boolean(group.provider.price_eur_month),
  );
  if (priced.length === 0) return null;

  const ordered = [...priced].sort((a, b) => b.valueIndex - a.valueIndex);
  const excluded = groups.length - priced.length;
  // The reference plan: everything is stated relative to the best value, not
  // relative to any vendor's own product.
  const baseline = ordered[0];
  const baselinePrice = baseline.provider.price_eur_month!;
  const baselineScore = baseline.performanceScore;

  return (
    <DsCard
      flush
      title="Work per €100"
      subtitle="Composite performance per euro of monthly list price · best-value plan = 100"
      footer={
        <>
          Same cross-host P50 evidence as the board — value never uses different
          numbers. Multiples are relative to the best-value plan
          {excluded > 0 &&
            ` · ${excluded} plan${excluded === 1 ? "" : "s"} without a public list price excluded`}
          .
        </>
      }
    >
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {[
                { label: "#", align: "left", width: 40 },
                { label: "Provider / plan", align: "left", width: 260 },
                { label: "Score", align: "right" },
                { label: "€ / mo", align: "right" },
                { label: "You pay · you get", align: "right", width: 170 },
                { label: "Work per €100", align: "left", width: 300 },
              ].map((c) => (
                <th
                  key={c.label}
                  className="pb-label h-[34px] border-b border-(--border-strong) bg-card px-(--pad-cell-x) whitespace-nowrap text-muted-foreground"
                  style={{
                    textAlign: c.align as "left" | "right",
                    width: c.width,
                  }}
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
              const price = group.provider.price_eur_month!;
              const { tier, cpu } = planCpuParts(
                group.provider.tier,
                group.system.cpu_cores,
              );
              const planLine = [
                group.provider.product,
                group.provider.plan,
                tier,
                group.provider.region,
                cpu,
              ]
                .filter(Boolean)
                .join(" · ");
              const isBaseline = group.id === baseline.id;
              const priceMultiple = price / baselinePrice;
              const workMultiple = group.performanceScore / baselineScore;

              return (
                <tr
                  key={group.id}
                  className={cn(
                    "h-14 border-b border-(--border-hairline) transition-colors last:border-b-0 hover:bg-(--surface-hover)",
                    !group.rankEligible && "opacity-60",
                  )}
                >
                  <td className="pb-num px-(--pad-cell-x) text-[13px] text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-(--pad-cell-x)">
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/providers/${name}`}
                        className="min-w-0 hover:underline"
                      >
                        <ProviderMark
                          name={providerLabel(name)}
                          color={color}
                          company={provider.company}
                          meta={planLine}
                        />
                      </Link>
                      {group.sample && <DsBadge tone="warn">Sample</DsBadge>}
                      {!group.rankEligible && !group.sample && (
                        <DsBadge tone="warn">Provisional</DsBadge>
                      )}
                    </span>
                  </td>
                  <td className="px-(--pad-cell-x) text-right">
                    <ScoreCell size="sm" value={Math.round(group.performanceScore)} />
                  </td>
                  <td className="pb-num px-(--pad-cell-x) text-right text-[13px] whitespace-nowrap text-foreground">
                    <span className="block">{price.toFixed(2)}</span>
                    {group.provider.price_eur_hour ? (
                      <span className="block text-[9.5px] text-(--text-faint)">
                        {group.provider.price_eur_hour.toFixed(4)}/h
                      </span>
                    ) : null}
                  </td>
                  <td className="pb-num px-(--pad-cell-x) text-right text-[12px] whitespace-nowrap">
                    {isBaseline ? (
                      <DsBadge tone="signal">best value</DsBadge>
                    ) : (
                      <span className="text-muted-foreground">
                        <span
                          className={
                            priceMultiple > workMultiple
                              ? "text-(--text-fail)"
                              : "text-foreground"
                          }
                        >
                          {priceMultiple.toFixed(1)}×
                        </span>{" "}
                        price ·{" "}
                        <span className="text-foreground">
                          {workMultiple.toFixed(1)}×
                        </span>{" "}
                        work
                      </span>
                    )}
                  </td>
                  <td className="px-(--pad-cell-x)">
                    <span
                      className="grid items-center gap-3"
                      style={{ gridTemplateColumns: "minmax(120px,1fr) 40px" }}
                    >
                      <span className="relative h-(--chart-bar-height) rounded-[2px] bg-(--bar-track)">
                        <span
                          className="absolute inset-y-0 left-0 rounded-[2px]"
                          style={{
                            width: `${Math.max(1.5, group.valueIndex)}%`,
                            background: color,
                            opacity: group.rankEligible ? 1 : 0.4,
                            transition: "var(--transition-bar)",
                          }}
                        />
                      </span>
                      <span
                        className="pb-num text-right text-[13px]"
                        style={{
                          color: isBaseline
                            ? "var(--text-primary)"
                            : "var(--text-muted)",
                          fontWeight: isBaseline ? 500 : 400,
                        }}
                      >
                        {Math.round(group.valueIndex)}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DsCard>
  );
}
