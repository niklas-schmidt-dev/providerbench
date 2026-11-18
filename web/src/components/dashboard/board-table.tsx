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
import { metricKey, priceLabel, type PlanDatum } from "@/lib/plans";
import { providerColor } from "@/lib/providers";
import { resolveTableColumns, type MetricRef } from "@/lib/report";
import { cn } from "@/lib/utils";

type Row = PlanDatum & { rank?: number };

/**
 * The board: every visible plan with its composite, value and the headline
 * metric of each suite. Sorted by composite; every column sorts. The best
 * cell per column is set in ink, the rest recede.
 */
export function BoardTable({ plans, metricRefs }: { plans: PlanDatum[]; metricRefs: MetricRef[] }) {
  const metricColumns = useMemo(() => resolveTableColumns(metricRefs), [metricRefs]);

  const rows = useMemo<Row[]>(() => {
    const ranked = plans.filter((p) => p.rankEligible).sort((a, b) => b.score - a.score);
    return plans.map((plan) => ({
      ...plan,
      rank: plan.rankEligible ? ranked.indexOf(plan) + 1 : undefined,
    }));
  }, [plans]);

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
    const maxScore = Math.max(...rows.map((r) => r.score), 1);
    return [
      {
        id: "rank",
        accessorFn: (row) => row.rank ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataGridColumnHeader column={column} title="#" />,
        cell: ({ row }) => (
          <span className="num text-subtle">{row.original.rank ?? "—"}</span>
        ),
        size: 52,
      },
      {
        id: "plan",
        accessorFn: (row) => `${row.providerName} ${row.plan}`,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Plan" />,
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <Link href={`/providers/${plan.provider}`} className="group flex items-center gap-2.5">
              <span aria-hidden className="h-4 w-0.5 rounded-full" style={{ background: providerColor(plan.provider) }} />
              {plan.company && <CompanyLogo company={plan.company} size="sm" decorative />}
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium group-hover:underline group-hover:underline-offset-3">
                  {plan.providerName} {plan.plan}
                </span>
                <span className="truncate text-[12px] text-subtle">
                  {[plan.region, plan.cores ? `${plan.cores} vCPU` : undefined, plan.memoryGb ? `${plan.memoryGb} GB` : undefined]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </Link>
          );
        },
        size: 240,
      },
      {
        id: "price",
        accessorFn: (row) => row.priceMonth ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataGridColumnHeader column={column} title="€ / mo" />,
        cell: ({ row }) => (
          <span className="num">{priceLabel(row.original) ?? "—"}</span>
        ),
        size: 92,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
      },
      {
        id: "score",
        accessorFn: (row) => row.score,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Score" />,
        cell: ({ row }) => (
          <span className="flex items-center justify-end gap-2.5">
            <span aria-hidden className="hidden h-1 w-14 overflow-hidden rounded-full bg-muted xl:block">
              <span
                className="block h-full rounded-full bg-foreground"
                style={{ width: `${(row.original.score / maxScore) * 100}%` }}
              />
            </span>
            <span className="num font-medium">{row.original.score.toFixed(1)}</span>
          </span>
        ),
        size: 120,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
      },
      {
        id: "value",
        accessorFn: (row) => row.value ?? -1,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Value" />,
        cell: ({ row }) => (
          <span className="num">{row.original.value !== undefined ? Math.round(row.original.value) : "—"}</span>
        ),
        size: 80,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
      },
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
          size: 112,
          meta: { headerClassName: "text-right", cellClassName: "text-right" },
        };
      }),
      {
        id: "hosts",
        accessorFn: (row) => row.hostCount,
        header: ({ column }) => <DataGridColumnHeader column={column} title="Hosts" />,
        cell: ({ row }) => <span className="num text-muted-foreground">{row.original.hostCount}</span>,
        size: 72,
        meta: { headerClassName: "text-right", cellClassName: "text-right" },
      },
      {
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
      },
    ];
  }, [rows, metricColumns, best]);

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    initialState: {
      sorting: [{ id: "score", desc: true }],
      pagination: { pageIndex: 0, pageSize: 100 },
    },
  });

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      emptyMessage="No plans in the current selection."
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
