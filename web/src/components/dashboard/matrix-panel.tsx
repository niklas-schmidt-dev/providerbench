"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

import { ChartPanel, Segmented } from "@/components/charts/chart-panel";
import { ChartTooltip, TooltipEvidence, TooltipHeader, TooltipRow } from "@/components/charts/chart-tooltip";
import { useWidth } from "@/components/charts/use-width";
import { CompanyLogo } from "@/components/company-logo";
import { SOURCE_LINK } from "@/components/dashboard/suite-panel";
import { isWordmark } from "@/lib/companies";
import { uniformFormat } from "@/lib/format";
import { currentHash } from "@/lib/hash";
import { metricKey, outcomesOf, planTitle, regionLabel, TESTS_SOURCE_URL, type PlanDatum } from "@/lib/plans";
import type { MatrixSection } from "@/lib/sections";
import { capitalize } from "@/lib/text";
import { cn } from "@/lib/utils";

const ALL = "all-tests";
/** Ink share of the cell furthest behind; text stays readable on it in both themes. */
const MAX_SHADE = 30;

type Cell = { value: number; shade: number; best: boolean };
type Row = { plan: PlanDatum; cells: (Cell | undefined)[]; behind: number };

/** A row's value in one column: the test's own, or the mean over several tests. */
function cellValue(plan: PlanDatum, tests: string[], metric: string): number | undefined {
  // A mean over tests only compares like with like when none is missing.
  const parts = tests.map((test) => plan.metrics[metricKey(test, metric)]?.p50);
  return parts.every((part) => part !== undefined)
    ? (parts as number[]).reduce((sum, part) => sum + part, 0) / parts.length
    : undefined;
}

/** Items solved behind one cell, summed over the tests it covers. */
function solvedItems(plan: PlanDatum, tests: string[], metric: string) {
  let solved = 0;
  let unanswered = 0;
  let items = 0;
  for (const test of tests) {
    const variants = outcomesOf(plan, test);
    const variant = Object.keys(variants ?? {}).find((key) => metric.endsWith(`_${key}`));
    const outcome = variant ? variants?.[variant] : undefined;
    if (!outcome) return undefined;
    solved += outcome.solved.reduce((sum, share) => sum + share, 0);
    unanswered += outcome.unanswered.reduce((sum, share) => sum + share, 0);
    items += outcome.solved.length;
  }
  const count = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return { solved: `${count(solved)} of ${items}`, unanswered: unanswered > 0 ? count(unanswered) : undefined };
}

/**
 * Rows against a set of like-for-like metrics: models against input
 * languages, vantage points against regions. Shade is how far a cell is
 * behind the best of its column, so the cells that fall behind stand out.
 */
export function MatrixPanel({
  section,
  plans,
  noun,
}: {
  section: MatrixSection;
  plans: PlanDatum[];
  noun: { one: string; many: string };
}) {
  const { tests, columns } = section;
  const several = tests.length > 1;
  const everyTest = useMemo(() => tests.map((test) => test.test), [tests]);
  // The mean over all tests is the first view, unless no row has every test:
  // then it would be a table of dashes.
  const [selected, setSelected] = useState(() =>
    several && plans.some((plan) => columns.every((column) => cellValue(plan, everyTest, column.metric) !== undefined))
      ? ALL
      : tests[0].test,
  );
  const [hover, setHover] = useState<{ plan: string; column: number; x: number; y: number } | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const active = useMemo(
    () => (selected === ALL ? tests : tests.filter((test) => test.test === selected)),
    [selected, tests],
  );

  // Deep links to a test (#arithmetic) or one of its metrics select that test.
  useEffect(() => {
    if (!several) return;
    const sync = () => {
      const hash = currentHash();
      const match =
        tests.find((test) => hash === test.anchor) ??
        tests.find((test) => columns.some((column) => hash === `${test.test}-${column.metric}`));
      if (match) setSelected(match.test);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [tests, columns, several]);

  const model = useMemo(() => {
    const names = active.map((test) => test.test);
    // A row belongs in the table when it reports any of the table's tests,
    // also where the current view has nothing to show for it.
    const raw = plans
      .filter((plan) =>
        columns.some((column) => everyTest.some((test) => Object.hasOwn(plan.metrics, metricKey(test, column.metric)))),
      )
      .map((plan) => ({ plan, values: columns.map((column) => cellValue(plan, names, column.metric)) }));
    if (raw.length === 0) return null;

    const pick = section.higherIsBetter ? Math.max : Math.min;
    const best = columns.map((_, index) => {
      const values = raw.flatMap((row) => (row.values[index] === undefined ? [] : [row.values[index]]));
      return values.length ? pick(...values) : undefined;
    });
    // How far a cell is behind the best of its column. Columns can differ in
    // magnitude (a near region, a far one), so a cell is never judged against
    // another column. The shade is on one scale all the same: the widest gap
    // in the table, so a small gap stays a faint shade.
    const gaps = raw.map((row) =>
      row.values.map((value, index) => (value === undefined ? undefined : Math.abs(value - best[index]!))),
    );
    const widest = Math.max(0, ...gaps.flatMap((row) => row.filter((gap): gap is number => gap !== undefined)));
    const rows: Row[] = raw
      .map((row, rowIndex) => {
        const known = gaps[rowIndex].filter((gap): gap is number => gap !== undefined);
        return {
          plan: row.plan,
          // Rows without a value in this view go last.
          behind: known.length ? known.reduce((sum, gap) => sum + gap, 0) / known.length : Infinity,
          cells: row.values.map((value, index) =>
            value === undefined
              ? undefined
              : {
                  value,
                  shade: widest > 0 ? (gaps[rowIndex][index]! / widest) * MAX_SHADE : 0,
                  best: value === best[index],
                },
          ),
        };
      })
      // Least behind first, so the table reads as an order without ranking anyone.
      .sort((a, b) => {
        if (a.behind !== b.behind) return a.behind < b.behind ? -1 : 1;
        return planTitle(a.plan).localeCompare(planTitle(b.plan));
      });
    const shown = raw.flatMap((row) => row.values.filter((value): value is number => value !== undefined));
    return { rows, format: uniformFormat(shown), names };
  }, [plans, columns, active, everyTest, section.higherIsBetter]);

  // The pointer rests on a row and a column, not on a position in the table:
  // filtering reorders the rows under it.
  const hovered = hover && model ? model.rows.find((row) => row.plan.id === hover.plan) : undefined;
  const hoveredCell = hover ? hovered?.cells[hover.column] : undefined;
  const hoveredItems =
    hover && hovered && model ? solvedItems(hovered.plan, model.names, columns[hover.column].metric) : undefined;
  const cohorts = plans.some((plan) => plan.hostCount > 1);
  const focus = selected === ALL ? undefined : active[0];

  const onEnter = (event: MouseEvent<HTMLTableCellElement>, plan: string, column: number) => {
    const box = ref.current?.getBoundingClientRect();
    const cell = event.currentTarget.getBoundingClientRect();
    if (box) setHover({ plan, column, x: cell.right - box.left - 8, y: cell.top - box.top + cell.height / 2 });
  };

  return (
    <ChartPanel
      id={section.id}
      anchors={[
        ...(several ? tests.map((test) => test.anchor) : []),
        ...tests.flatMap((test) => columns.map((column) => `${test.test}-${column.metric}`)),
      ]}
      title={section.title}
      description={several ? undefined : tests[0].summary}
      controls={
        several ? (
          <Segmented
            label={`${section.title}: test`}
            value={selected}
            onChange={setSelected}
            options={[{ value: ALL, label: "All tests" }, ...tests.map((test) => ({ value: test.test, label: test.label }))]}
          />
        ) : undefined
      }
      footer={
        <>
          {focus && several && (
            <>
              <span className="text-muted-foreground">{focus.label}.</span> {focus.summary ? `${focus.summary}. ` : ""}
            </>
          )}
          {selected === ALL &&
            `All tests is the mean over the ${tests.length} tests; a ${noun.one} that lacks one of them shows no mean. `}
          {cohorts ? "Each cell is a cross-host P50." : "Each cell is the value a report measured."} Shade is how far a
          cell is behind the best of its column: the stronger the shade, the further behind. The best of each column
          is set in bold, and rows run from the least to the most behind.{" "}
          <a href={focus?.sourceUrl ?? (several ? TESTS_SOURCE_URL : tests[0].sourceUrl)} className={SOURCE_LINK}>
            Benchmark source
          </a>
        </>
      }
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {!model ? (
          <p className="py-16 text-center text-[13px] text-muted-foreground">
            Nothing in the current selection reports these metrics.
          </p>
        ) : (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[520px] border-separate border-spacing-[2px] text-[13px]">
              <caption className="pb-2 text-left text-[12px] text-muted-foreground">
                {section.unit} · {section.higherIsBetter ? "higher is better" : "lower is better"}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="h-8 pr-4 text-left text-[12px] font-normal text-subtle">
                    {capitalize(noun.one)}
                  </th>
                  {columns.map((column) => (
                    <th
                      key={column.metric}
                      scope="col"
                      className="h-8 px-2.5 text-right text-[12px] font-normal whitespace-nowrap text-subtle"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((row) => (
                  <tr key={row.plan.id}>
                    <th scope="row" className="max-w-[170px] py-0 pr-4 text-left font-normal sm:max-w-[260px]">
                      <Link href={`/providers/${row.plan.provider}`} className="group flex h-8 items-center gap-2.5">
                        <span aria-hidden className="h-4 w-0.5 shrink-0 rounded-full" style={{ background: row.plan.color }} />
                        {/* A wordmark stands in for the provider's name, so there it is not decoration. */}
                        {row.plan.company && (
                          <CompanyLogo company={row.plan.company} size="sm" decorative={!isWordmark(row.plan.company)} />
                        )}
                        <span className="truncate group-hover:underline group-hover:underline-offset-3">
                          {planTitle(row.plan)}
                        </span>
                        {/* The region, unless the row's name already carries it. */}
                        {regionLabel(row.plan) && row.plan.label === row.plan.plan && (
                          <span className="hidden shrink-0 text-[12px] text-subtle sm:inline">{regionLabel(row.plan)}</span>
                        )}
                        {row.plan.quick && <span className="hidden shrink-0 text-[12px] text-subtle sm:inline">quick</span>}
                      </Link>
                    </th>
                    {row.cells.map((cell, columnIndex) => (
                      <td
                        key={columns[columnIndex].metric}
                        onMouseEnter={cell ? (event) => onEnter(event, row.plan.id, columnIndex) : undefined}
                        className={cn(
                          "num h-8 rounded-[4px] px-2.5 text-right whitespace-nowrap",
                          cell?.best ? "font-semibold" : "font-normal",
                        )}
                        style={
                          cell
                            ? { background: `color-mix(in oklab, var(--foreground) ${cell.shade.toFixed(1)}%, transparent)` }
                            : undefined
                        }
                      >
                        {cell ? model.format(cell.value) : <span className="text-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hover && hovered && hoveredCell && model && (
          <ChartTooltip x={hover.x} y={hover.y} width={width}>
            <TooltipHeader plan={hovered.plan} />
            <TooltipRow
              label={`${columns[hover.column].label}${focus ? ` · ${focus.label}` : ""}`}
              value={`${model.format(hoveredCell.value)} ${section.unit}`}
            />
            {hoveredItems && <TooltipRow label="Solved" value={hoveredItems.solved} />}
            {hoveredItems?.unanswered && <TooltipRow label="No usable answer" value={hoveredItems.unanswered} />}
            <TooltipEvidence plan={hovered.plan} />
          </ChartTooltip>
        )}
      </div>
    </ChartPanel>
  );
}
