"use client";

import { RotateCcw, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { formatEuro } from "@/components/charts/scales";
import type { PlanDatum } from "@/lib/plans";
import { providerColor } from "@/lib/providers";
import { cn } from "@/lib/utils";

export type PlanFilters = {
  hidden: Set<string>;
  excludedTiers: Set<string>;
  showProvisional: boolean;
  query: string;
};

export const TIER_LABELS: Record<string, string> = {
  cheap: "Shared",
  medium: "Performance",
  dedicated: "Dedicated",
  "usage-based": "Usage-based",
};

export function tierOf(plan: PlanDatum): string {
  return plan.tier ?? "other";
}

/**
 * The plan list: every measured plan, grouped by provider, each with its
 * series dot. A filled dot is on the charts, a hollow one is off. Tier
 * chips and the provisional switch narrow every chart at once.
 */
export function PlanSidebar({
  plans,
  filters,
  onChange,
  onReset,
  open,
  onClose,
  footer,
}: {
  plans: PlanDatum[];
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  onReset: () => void;
  open: boolean;
  onClose: () => void;
  footer: React.ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the plan search, like the reference's model finder.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const tiers = useMemo(() => [...new Set(plans.map(tierOf))], [plans]);
  const query = filters.query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byProvider = new Map<string, PlanDatum[]>();
    for (const plan of plans) {
      const haystack = `${plan.providerName} ${plan.plan} ${plan.region ?? ""} ${plan.tier ?? ""}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      const list = byProvider.get(plan.provider) ?? [];
      list.push(plan);
      byProvider.set(plan.provider, list);
    }
    return [...byProvider.values()];
  }, [plans, query]);

  const visibleCount = plans.filter((plan) => isVisible(plan, filters)).length;
  const anyProvisional = plans.some((plan) => !plan.rankEligible);
  const dirty =
    filters.hidden.size > 0 || filters.excludedTiers.size > 0 || !filters.showProvisional || filters.query !== "";

  const toggle = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close plan filters"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0 lg:hidden"
        />
      )}
      <aside
        aria-label="Plans"
        className={cn(
          "flex-col border-l border-border bg-background",
          "lg:sticky lg:top-(--header-height) lg:flex lg:h-[calc(100dvh-var(--header-height))]",
          open
            ? "fixed top-0 right-0 bottom-0 z-50 flex w-[min(320px,88vw)] animate-in slide-in-from-right-8 fade-in-0 duration-200 lg:bottom-auto lg:z-auto lg:w-auto lg:animate-none"
            : "hidden",
        )}
      >
        <div className="flex items-center justify-between gap-2 px-5 pt-5">
          <h2 className="flex items-baseline gap-2 text-base font-medium tracking-tight">
            Plans
            <span className="num text-[12px] font-normal text-subtle">
              {visibleCount === plans.length ? plans.length : `${visibleCount} / ${plans.length}`}
            </span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onReset}
              disabled={!dirty}
              aria-label="Reset plan filters"
              className="grid size-8 place-items-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <RotateCcw aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close plan filters"
              className="grid size-8 place-items-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-foreground lg:hidden"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        </div>

        <label className="mx-5 mt-3 flex h-9 items-center gap-2 border-b border-border text-[13px] focus-within:border-foreground">
          <Search aria-hidden className="size-3.5 text-subtle" />
          <span className="sr-only">Find plans</span>
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder="Find plans"
            className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-subtle sm:text-[13px]"
          />
          <kbd className="font-sans text-[12px] text-faint">/</kbd>
        </label>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pt-4 pb-5">
          {tiers.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[12px] font-medium">Tier</h3>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {tiers.map((tier) => {
                  const excluded = filters.excludedTiers.has(tier);
                  return (
                    <button
                      key={tier}
                      type="button"
                      aria-pressed={!excluded}
                      onClick={() => onChange({ ...filters, excludedTiers: toggle(filters.excludedTiers, tier) })}
                      className={cn(
                        "h-6 text-[12px] transition-colors",
                        excluded ? "text-faint line-through hover:text-subtle" : "text-foreground hover:text-muted-foreground",
                      )}
                    >
                      {TIER_LABELS[tier] ?? tier}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {groups.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No plan matches &ldquo;{filters.query}&rdquo;.
            </p>
          )}

          {groups.map((group) => {
            const first = group[0];
            return (
              <div key={first.provider} className="flex flex-col gap-0.5">
                <Link
                  href={`/providers/${first.provider}`}
                  className="mb-1 flex items-center gap-2 text-[12px] font-medium transition-colors hover:text-muted-foreground"
                >
                  {first.company && <CompanyLogo company={first.company} size="xs" decorative />}
                  {first.providerName}
                </Link>
                {group.map((plan) => {
                  const on = isVisible(plan, filters);
                  const blocked = !on && !filters.hidden.has(plan.id);
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange({ ...filters, hidden: toggle(filters.hidden, plan.id) })}
                      title={blocked ? "Hidden by the tier or provisional filter" : undefined}
                      className={cn(
                        "-mx-2 flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors hover:bg-hover",
                        on ? "text-foreground" : "text-subtle",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {plan.plan}
                        {plan.region && <span className="ml-1.5 text-[12px] text-subtle">{plan.region}</span>}
                      </span>
                      {plan.priceMonth !== undefined && (
                        <span className="num text-[12px] text-subtle">{formatEuro(plan.priceMonth)}</span>
                      )}
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full border-[1.5px]"
                        style={{
                          borderColor: providerColor(plan.provider),
                          background: on ? providerColor(plan.provider) : "transparent",
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}

          {anyProvisional && (
            <button
              type="button"
              role="switch"
              aria-checked={filters.showProvisional}
              onClick={() => onChange({ ...filters, showProvisional: !filters.showProvisional })}
              className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Show provisional cohorts
              <span
                aria-hidden
                className={cn(
                  "relative h-4 w-7 rounded-full transition-colors",
                  filters.showProvisional ? "bg-foreground" : "bg-border-strong",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-3 rounded-full bg-background transition-transform duration-200",
                    filters.showProvisional ? "translate-x-3.5" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          )}
        </div>

        <div className="border-t border-border px-5 py-4 text-[12px] leading-[18px] text-subtle">{footer}</div>
      </aside>
    </>
  );
}

export function isVisible(plan: PlanDatum, filters: PlanFilters): boolean {
  return (
    !filters.hidden.has(plan.id) &&
    !filters.excludedTiers.has(tierOf(plan)) &&
    (filters.showProvisional || plan.rankEligible)
  );
}
