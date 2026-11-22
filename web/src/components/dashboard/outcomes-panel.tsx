"use client";

import { Fragment, useEffect, useState, type MouseEvent } from "react";

import { ChartPanel, Segmented } from "@/components/charts/chart-panel";
import { ChartTooltip, TooltipHeader, TooltipRow } from "@/components/charts/chart-tooltip";
import { useWidth } from "@/components/charts/use-width";
import { CompanyLogo } from "@/components/company-logo";
import type { OutcomeSummary } from "@/lib/aggregate";
import { isWordmark } from "@/lib/companies";
import { currentHash } from "@/lib/hash";
import { outcomesOf, planTitle, type PlanDatum } from "@/lib/plans";
import type { OutcomesSection } from "@/lib/sections";

type Hover = { plan: PlanDatum; variant: string; item: number; outcome: OutcomeSummary; x: number; y: number };

function count(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function total(shares: number[]): number {
  return shares.reduce((sum, share) => sum + share, 0);
}

function itemState(outcome: OutcomeSummary, item: number): string {
  const solved = outcome.solved[item];
  const unanswered = outcome.unanswered[item];
  if (outcome.reports > 1) {
    return `solved in ${count(solved * outcome.reports)} of ${outcome.reports} reports`;
  }
  return solved === 1 ? "Solved" : unanswered === 1 ? "No usable answer" : "Wrong";
}

/** Items per group when they divide evenly; a quick report asks fewer items in the same groups. */
function groupSize(items: number, groups: OutcomesSection["groups"]): number | undefined {
  return groups && items % groups.count === 0 ? items / groups.count : undefined;
}

function Mark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={`inline-block h-3 w-2 rounded-[2px] ${className ?? ""}`} style={style} />;
}

const SOLVED = "color-mix(in oklab, var(--foreground) 9%, transparent)";

/**
 * How every single item of a test went: one mark per item, in protocol
 * order, one strip per variant of the items. Every variant asks the same
 * items, so a column of marks is the same item in another variant.
 */
export function OutcomesPanel({
  section,
  plans,
  noun,
}: {
  section: OutcomesSection;
  plans: PlanDatum[];
  noun: { one: string; many: string };
}) {
  const [test, setTest] = useState(section.tests[0].test);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = plans.flatMap((plan) => {
    const outcomes = outcomesOf(plan, test);
    return outcomes ? [{ plan, outcomes }] : [];
  });

  // A deep link to a test (#arithmetic) selects it here too.
  useEffect(() => {
    const sync = () => {
      const hash = currentHash();
      if (section.tests.some((entry) => entry.test === hash)) setTest(hash);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [section.tests]);

  const onMove = (event: MouseEvent<HTMLDivElement>, plan: PlanDatum, variant: string, outcome: OutcomeSummary) => {
    const target = event.target as HTMLElement;
    const item = Number(target.dataset.item);
    const box = ref.current?.getBoundingClientRect();
    if (!box || !target.dataset.item) return;
    const mark = target.getBoundingClientRect();
    setHover({ plan, variant, item, outcome, x: mark.right - box.left, y: mark.top - box.top + 8 });
  };

  const items = Math.max(0, ...rows.flatMap((row) => Object.values(row.outcomes).map((o) => o.solved.length)));
  const headerSize = groupSize(items, section.groups);

  return (
    <ChartPanel
      id={section.id}
      title={section.title}
      description={`How each item of a test went, for every ${noun.one} and every variant of the items.`}
      controls={
        section.tests.length > 1 ? (
          <Segmented
            label="Items: test"
            value={test}
            onChange={setTest}
            options={section.tests.map((entry) => ({ value: entry.test, label: entry.label }))}
          />
        ) : undefined
      }
      footer={
        <>
          One mark per item, in the order the protocol asks them
          {section.groups ? `, in ${section.groups.count} equal groups` : ""}. Every variant asks the same items, so
          marks above each other are one item asked in different variants. The number on the right is how many items
          were solved.
        </>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Mark style={{ background: SOLVED }} /> Solved
          </li>
          <li className="flex items-center gap-1.5">
            <Mark className="bg-foreground" /> Wrong
          </li>
          <li className="flex items-center gap-1.5">
            <Mark className="shadow-[inset_0_0_0_1.5px_var(--foreground)]" /> No usable answer
          </li>
        </ul>

        {rows.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-muted-foreground">
            Nothing in the current selection records item outcomes for this test.
          </p>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <div className="grid min-w-[340px] grid-cols-[minmax(64px,auto)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 text-[13px]">
              {headerSize && section.groups && (
                <>
                  <span />
                  <div aria-hidden className="flex gap-1.5 text-[11px] text-subtle">
                    {Array.from({ length: section.groups.count }, (_, index) => (
                      <span key={index} className="min-w-0 flex-1 truncate">
                        {section.groups!.label} {index + 1}
                      </span>
                    ))}
                  </div>
                  <span />
                </>
              )}
              {rows.map(({ plan, outcomes }) => (
                <Fragment key={plan.id}>
                  <div className="col-span-full mt-3 flex items-center gap-2.5 first:mt-0">
                    <span aria-hidden className="h-4 w-0.5 rounded-full" style={{ background: plan.color }} />
                    {plan.company && <CompanyLogo company={plan.company} size="sm" decorative={!isWordmark(plan.company)} />}
                    <span className="font-medium">{planTitle(plan)}</span>
                    {plan.quick && <span className="text-[12px] text-subtle">quick</span>}
                  </div>
                  {section.variants.map((variant) => {
                    if (!Object.hasOwn(outcomes, variant.key)) return null;
                    const outcome = outcomes[variant.key];
                    const size = groupSize(outcome.solved.length, section.groups) ?? outcome.solved.length;
                    const solved = total(outcome.solved);
                    const unanswered = total(outcome.unanswered);
                    return (
                      <Fragment key={variant.key}>
                        <span className="text-[12px] text-muted-foreground">{variant.label}</span>
                        <div
                          role="img"
                          aria-label={`${plan.providerName} ${plan.label}, ${variant.label}: ${count(solved)} of ${outcome.solved.length} items solved${unanswered > 0 ? `, ${count(unanswered)} without a usable answer` : ""}`}
                          onMouseMove={(event) => onMove(event, plan, variant.label, outcome)}
                          className="flex h-4 gap-1.5"
                        >
                          {Array.from({ length: Math.ceil(outcome.solved.length / size) }, (_, group) => (
                            <span key={group} className="flex min-w-0 flex-1 gap-px">
                              {outcome.solved.slice(group * size, (group + 1) * size).map((share, offset) => {
                                const item = group * size + offset;
                                const missing = outcome.unanswered[item];
                                const wrong = Math.max(0, 1 - share - missing);
                                return (
                                  <span
                                    key={item}
                                    data-item={item}
                                    className="min-w-[3px] flex-1 rounded-[2px]"
                                    style={{
                                      background:
                                        wrong > 0
                                          ? `color-mix(in oklab, var(--foreground) ${Math.round(9 + 91 * wrong)}%, transparent)`
                                          : missing >= 1
                                            ? "transparent"
                                            : SOLVED,
                                      boxShadow:
                                        missing > 0
                                          ? `inset 0 0 0 1.5px color-mix(in oklab, var(--foreground) ${Math.round(missing * 100)}%, transparent)`
                                          : undefined,
                                    }}
                                  />
                                );
                              })}
                            </span>
                          ))}
                        </div>
                        <span className="num text-right text-[12px] text-muted-foreground">
                          <span className="font-medium text-foreground">{count(solved)}</span> / {outcome.solved.length}
                        </span>
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {hover && (
          <ChartTooltip x={hover.x} y={hover.y} width={width}>
            <TooltipHeader plan={hover.plan} />
            <TooltipRow label={hover.variant} value={itemState(hover.outcome, hover.item)} />
            <TooltipRow label="Item" value={`${hover.item + 1} of ${hover.outcome.solved.length}`} />
            {section.groups && groupSize(hover.outcome.solved.length, section.groups) && (
              <TooltipRow
                label={section.groups.label}
                value={Math.floor(hover.item / groupSize(hover.outcome.solved.length, section.groups)!) + 1}
              />
            )}
          </ChartTooltip>
        )}
      </div>
    </ChartPanel>
  );
}
