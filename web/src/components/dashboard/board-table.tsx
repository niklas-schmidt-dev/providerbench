"use client";

import { useTable, type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/reui/badge";
import {
  DataGrid,
  DataGridContainer,
  dataGridFeatures,
  type DataGridFeatures,
} from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { isWordmark } from "@/lib/companies";
import { uniformFormat } from "@/lib/format";
import { metricKey, planTitle, priceLabel, regionLabel, type PlanDatum } from "@/lib/plans";
import { decimalFormat, type BoardColumn } from "@/lib/report";
import { capitalize } from "@/lib/text";
import { cn } from "@/lib/utils";

type Row = PlanDatum & { rank?: number };

const RIGHT = { headerClassName: "text-right", cellClassName: "text-right" };

/**
 * The board: every visible row with the metrics the category puts on it, and
 * with its composite and value where the category has a ranking. Every column
 * sorts. The best cell per column is set in ink, the rest recede.
 */
export function BoardTable({
  plans,
  columns: boardColumns,
  scored,
  priced,
  measuresMachine,
  noun,
}: {
  plans: PlanDatum[];
  columns: BoardColumn[];
  /** The category has a composite score: show rank, score, value and status. */
  scored: boolean;
  priced: boolean;
  /** A row's CPU and memory describe what was measured. */
  measuresMachine: boolean;
  noun: { one: string; many: string };
}) {
  // A column that sets no precision takes one from the values of its test
  // that share its unit, so neighbouring columns of like numbers line up.
  const metricColumns = useMemo(() => {
    const family = (column: BoardColumn) => `${column.test}|${column.unit}`;
    const values = new Map<string, number[]>();
    for (const column of boardColumns) {
      const key = metricKey(column.test, column.metric);
      const own = plans.flatMap((plan) => (plan.metrics[key] ? [plan.metrics[key].p50] : []));
      values.set(family(column), [...(values.get(family(column)) ?? []), ...own]);
    }
    return boardColumns.map((column) => ({
      ...column,
      format:
        column.decimals === undefined ? uniformFormat(values.get(family(column))!) : decimalFormat(column.decimals),
    }));
  }, [boardColumns, plans]);

  const rows = useMemo<Row[]>(() => {
    const ranked = plans.filter((p) => p.rankEligible).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return plans.map((plan) => ({
      ...plan,
      rank: scored && plan.rankEligible ? ranked.indexOf(plan) + 1 : undefined,
    }));
  }, [plans, scored]);

  const best = useMemo(() => {
    const result = new Map<string, number>();
    for (const column of metricColumns) {
      const key = metricKey(column.test, column.metric);
      const values = rows.flatMap((row) => (row.metrics[key] ? [row.metrics[key].p50] : []));
      if (values.length) result.set(key, column.higherIsBetter ? Math.max(...values) : Math.min(...values));
    }
    return result;
  }, [rows, metricColumns]);

  const columns = useMemo<ColumnDef<DataGridFeatures, Row>[]>(() => {
    const maxScore = Math.max(...rows.map((r) => r.score ?? 0), 1);
    const cohorts = rows.some((row) => row.hostCount > 1);
    const rank: ColumnDef<DataGridFeatures, Row> = {
      id: "rank",
      accessorFn: (row) => row.rank ?? Number.POSITIVE_INFINITY,
      header: ({ column }) => <DataGridColumnHeader column={column} title="#" />,
      cell: ({ row }) => <span className="num text-subtle">{row.original.rank ?? "—"}</span>,
      size: 52,
    };
    const name: ColumnDef<DataGridFeatures, Row> = {
      id: "plan",
      accessorFn: (row) => `${row.providerName} ${row.label}`,
      header: ({ column }) => <DataGridColumnHeader column={column} title={capitalize(noun.one)} />,
      cell: ({ row }) => {
        const plan = row.original;
        // The region, unless the row's name already carries it.
        const region = plan.label === plan.plan ? regionLabel(plan) : undefined;
        const facts = measuresMachine
          ? [region, plan.cores ? `${plan.cores} vCPU` : undefined, plan.memoryGb ? `${plan.memoryGb} GB` : undefined]
          : [plan.product, region];
        return (
          <Link href={`/providers/${plan.provider}`} className="group flex items-center gap-2.5">
            <span aria-hidden className="h-4 w-0.5 rounded-full" style={{ background: plan.color }} />
            {plan.company && <CompanyLogo company={plan.company} size="sm" decorative={!isWordmark(plan.company)} />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium group-hover:underline group-hover:underline-offset-3">
                {planTitle(plan)}
              </span>
              <span className="truncate text-[12px] text-subtle">
                {[...facts, plan.quick ? "quick run" : undefined].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
        );
      },
      // Room for the longest name, within reason.
      size: Math.min(320, Math.max(240, Math.round(Math.max(0, ...rows.map((row) => planTitle(row).length)) * 7.2) + 70)),
    };
    const price: ColumnDef<DataGridFeatures, Row> = {
      id: "price",
      accessorFn: (row) => row.priceMonth ?? Number.POSITIVE_INFINITY,
      header: ({ column }) => <DataGridColumnHeader column={column} title="€ / mo" />,
      cell: ({ row }) => <span className="num">{priceLabel(row.original) ?? "—"}</span>,
      size: 92,
      meta: RIGHT,
    };
    const score: ColumnDef<DataGridFeatures, Row> = {
      id: "score",
      accessorFn: (row) => row.score ?? -1,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Score" />,
      cell: ({ row }) => (
        <span className="flex items-center justify-end gap-2.5">
          <span aria-hidden className="hidden h-1 w-14 overflow-hidden rounded-full bg-muted xl:block">
            <span
              className="block h-full rounded-full bg-foreground"
              style={{ width: `${((row.original.score ?? 0) / maxScore) * 100}%` }}
            />
          </span>
          <span className="num font-medium">{row.original.score?.toFixed(1) ?? "—"}</span>
        </span>
      ),
      size: 120,
      meta: RIGHT,
    };
    const value: ColumnDef<DataGridFeatures, Row> = {
      id: "value",
      accessorFn: (row) => row.value ?? -1,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Value" />,
      cell: ({ row }) => (
        <span className="num">{row.original.value !== undefined ? Math.round(row.original.value) : "—"}</span>
      ),
      size: 80,
      meta: RIGHT,
    };
    const hosts: ColumnDef<DataGridFeatures, Row> = {
      id: "hosts",
      accessorFn: (row) => row.hostCount,
      header: ({ column }) => <DataGridColumnHeader column={column} title="Hosts" />,
      cell: ({ row }) => <span className="num text-muted-foreground">{row.original.hostCount}</span>,
      size: 72,
      meta: RIGHT,
    };
    const status: ColumnDef<DataGridFeatures, Row> = {
      id: "status",
      accessorFn: (row) => (row.rankEligible ? 0 : 1),
      header: ({ column }) => <DataGridColumnHeader column={column} title="Status" />,
      cell: ({ row }) =>
        row.original.rankEligible ? (
          <Badge variant="secondary">Ranked</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Provisional
          </Badge>
        ),
      size: 104,
    };
    return [
      ...(scored ? [rank] : []),
      name,
      ...(priced ? [price] : []),
      ...(scored ? [score] : []),
      ...(scored && priced ? [value] : []),
      ...metricColumns.map<ColumnDef<DataGridFeatures, Row>>((column) => {
        const key = metricKey(column.test, column.metric);
        return {
          id: key,
          accessorFn: (row) => row.metrics[key]?.p50 ?? (column.higherIsBetter ? -Infinity : Infinity),
          header: ({ column: c }) => <DataGridColumnHeader column={c} title={column.label} />,
          cell: ({ row }) => {
            const stat = row.original.metrics[key];
            if (!stat) return <span className="text-faint">—</span>;
            const isBest = best.get(key) === stat.p50;
            return (
              <span className={cn("num", isBest ? "font-medium text-foreground" : "text-muted-foreground")}>
                {column.format(stat.p50)}
                <span className="ml-1 text-[11px] text-faint">{column.unit}</span>
              </span>
            );
          },
          // Room for the label: a category laid out from its reports names
          // each column after its test and metric.
          size: Math.max(112, Math.round(column.label.length * 6.8) + 30),
          meta: RIGHT,
        };
      }),
      ...(scored || cohorts ? [hosts] : []),
      ...(scored ? [status] : []),
    ];
  }, [rows, metricColumns, best, scored, priced, measuresMachine, noun]);

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    initialState: {
      sorting: [scored ? { id: "score", desc: true } : { id: "plan", desc: false }],
      // One page, however long: the board has no pager.
      pagination: { pageIndex: 0, pageSize: Math.max(100, plans.length) },
    },
  });

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      emptyMessage={`No ${noun.many} in the current selection.`}
      tableLayout={{ dense: true, headerSticky: false, width: "fixed" }}
      tableClassNames={{
        base: "text-[13px]",
        edgeCell: "first:ps-4 last:pe-4 sm:first:ps-7 sm:last:pe-7",
      }}
    >
      <DataGridContainer className="rounded-none border-x-0">
        <DataGridScrollArea orientation="horizontal">
          <DataGridTable />
        </DataGridScrollArea>
      </DataGridContainer>
    </DataGrid>
  );
}
