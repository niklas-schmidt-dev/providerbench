import type { ReactNode } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { isWordmark } from "@/lib/companies";
import type { PlanDatum } from "@/lib/plans";
import { cn } from "@/lib/utils";

const TOOLTIP_WIDTH = 220;

/**
 * Hover card positioned in chart pixels: right of the mark when it fits,
 * otherwise left of it, always clamped inside the chart.
 */
export function ChartTooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
  const w = Math.min(TOOLTIP_WIDTH, width);
  const left = x + 14 + w <= width ? x + 14 : Math.max(0, Math.min(x - 14 - w, width - w));
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-none absolute z-10 rounded-md border border-border-strong bg-popover px-3 py-2.5 text-[12px] leading-[18px] text-popover-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18)]",
        "animate-in fade-in-0 duration-150",
      )}
      style={{ left, width: w, top: Math.max(0, y - 20) }}
    >
      {children}
    </div>
  );
}

export function TooltipHeader({ plan }: { plan: PlanDatum }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: plan.color }}
      />
      {/* A wordmark stands in for the name, so there it is not decoration. */}
      {plan.company && <CompanyLogo company={plan.company} size="xs" decorative={!isWordmark(plan.company)} />}
      {!isWordmark(plan.company) && <span className="font-medium">{plan.providerName}</span>}
      <span className="text-muted-foreground">{plan.label}</span>
    </div>
  );
}

export function TooltipRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium">{value}</span>
    </div>
  );
}

/**
 * What stands behind a number: its hosts, and any caveat of the row. `hosts`
 * is the host count behind the one metric shown. A row can join cohorts of
 * two profiles, so it is not always the row's own count.
 */
export function TooltipEvidence({ plan, hosts = plan.hostCount }: { plan: PlanDatum; hosts?: number }) {
  return (
    <>
      {(hosts > 1 || (plan.freshHostCount > 0 && hosts === plan.hostCount)) && (
        <TooltipRow label={plan.freshHostCount >= hosts ? "Fresh hosts" : "Hosts"} value={hosts} />
      )}
      {plan.provisional && <p className="mt-1 text-subtle">Provisional · not ranked yet</p>}
      {plan.quick && <p className="mt-1 text-subtle">Quick run · smaller workloads</p>}
    </>
  );
}
