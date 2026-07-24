import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { metricSummary, type ScoredGroup } from "@/lib/aggregate";
import { formatMeasurementWindow } from "@/lib/dates";
import { planCpuParts } from "@/lib/format";
import { getProvider, providerColor, providerLabel } from "@/lib/providers";

type Column = {
  label: string;
  unit: string;
  test: string;
  metric: string;
  higherIsBetter: boolean;
  format?: (v: number) => string;
};

const COLUMNS: Column[] = [
  { label: "CPU 1-core", unit: "MB/s", test: "cpu", metric: "single_core_hash", higherIsBetter: true },
  { label: "CPU all-core", unit: "MB/s", test: "cpu", metric: "multi_core_hash", higherIsBetter: true },
  { label: "Mem BW", unit: "GB/s", test: "memory", metric: "copy_bandwidth", higherIsBetter: true, format: (v) => v.toFixed(1) },
  { label: "Seq write", unit: "MB/s", test: "disk", metric: "seq_write", higherIsBetter: true },
  { label: "4K read", unit: "IOPS", test: "disk", metric: "rand_read_4k", higherIsBetter: true },
  { label: "fsync p50", unit: "ms", test: "disk", metric: "fsync_latency_p50", higherIsBetter: false, format: (v) => v.toFixed(2) },
  { label: "Download", unit: "Mbps", test: "network", metric: "download", higherIsBetter: true },
  { label: "Consistency", unit: "CV %", test: "steal", metric: "consistency_cv", higherIsBetter: false, format: (v) => v.toFixed(1) },
  { label: "Steal", unit: "%", test: "steal", metric: "cpu_steal", higherIsBetter: false, format: (v) => v.toFixed(2) },
];

const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

function planLine(group: ScoredGroup): string {
  const { tier, cpu } = planCpuParts(group.provider.tier, group.system.cpu_cores);
  return [group.provider.product, group.provider.plan, tier, group.provider.region, cpu]
    .filter(Boolean)
    .join(" · ");
}

export function ComparisonTable({ groups }: { groups: ScoredGroup[] }) {
  const bests = COLUMNS.map((c) => {
    const values = groups
      .map((group) => metricSummary(group, c.test, c.metric)?.distribution.p50)
      .filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return c.higherIsBetter ? Math.max(...values) : Math.min(...values);
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Provider / plan</TableHead>
            <TableHead className="text-right">€/mo</TableHead>
            <TableHead className="text-right">
              <span className="block">Perf.</span>
              <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                index
              </span>
            </TableHead>
            <TableHead className="text-right">
              <span className="block">Value</span>
              <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                index
              </span>
            </TableHead>
            {COLUMNS.map((c) => (
              <TableHead key={c.metric} className="text-right">
                <span className="block">{c.label}</span>
                <span className="block font-mono text-[10px] font-normal text-muted-foreground">
                  {c.unit}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => {
            const name = group.provider.name ?? group.id;
            const provider = getProvider(name);
            return (
              <TableRow key={group.id} className={!group.rankEligible ? "opacity-70" : undefined}>
                <TableCell className="pl-4">
                  <Link
                    href={`/providers/${name}`}
                    className="flex items-center gap-2.5 hover:underline"
                  >
                    {provider.company ? (
                      <CompanyLogo company={provider.company} size="sm" decorative />
                    ) : (
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted"
                      />
                    )}
                    <span>
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ background: providerColor(name) }}
                        />
                        {providerLabel(name)}
                        {group.sample && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] font-normal text-warning"
                          >
                            sample
                          </Badge>
                        )}
                        {!group.rankEligible && !group.sample && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[9px] font-normal text-warning"
                          >
                            provisional
                          </Badge>
                        )}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {planLine(group)}
                      </span>
                      <span className="block font-mono text-[9px] text-muted-foreground/75">
                        {group.hostCount} independent host{group.hostCount === 1 ? "" : "s"} ·{" "}
                        {group.runCount} run{group.runCount === 1 ? "" : "s"}
                      </span>
                      <span className="block font-mono text-[9px] text-brand/85">
                        measured{" "}
                        {formatMeasurementWindow(
                          group.measuredFrom,
                          group.measuredTo,
                        )}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  <span className="block">
                    {group.provider.price_eur_month
                      ? group.provider.price_eur_month.toFixed(2)
                      : "—"}
                  </span>
                  {group.provider.price_eur_hour ? (
                    <span className="block text-[9px] text-muted-foreground/70">
                      {group.provider.price_eur_hour.toFixed(4)}/h
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {group.performanceScore.toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-brand">
                  {group.valueIndex?.toFixed(1) ?? "—"}
                </TableCell>
                {COLUMNS.map((c, i) => {
                  const summary = metricSummary(group, c.test, c.metric);
                  const distribution = summary?.distribution;
                  const isBest =
                    distribution !== undefined && distribution.p50 === bests[i];
                  return (
                    <TableCell key={c.metric} className="text-right font-mono text-xs tabular-nums">
                      <span className={isBest ? "text-foreground" : "text-muted-foreground"}>
                        {distribution ? (c.format ?? fmt)(distribution.p50) : "—"}
                      </span>
                      {isBest && (
                        <Badge
                          variant="secondary"
                          className="ml-1.5 h-4 px-1 text-[9px] text-success"
                        >
                          best
                        </Badge>
                      )}
                      {distribution && (
                        <span
                          className="mt-0.5 block text-[9px] text-muted-foreground/65"
                          title={`mean ${distribution.mean}; p10 ${distribution.p10}; p90 ${distribution.p90}; p99 ${distribution.p99}`}
                        >
                          {/* Always surface the BAD tail: the slowest hosts
                              for throughput, the worst latencies for delays. */}
                          {c.higherIsBetter ? (
                            <>
                              μ{(c.format ?? fmt)(distribution.mean)} · p10{" "}
                              {(c.format ?? fmt)(distribution.p10)}
                            </>
                          ) : (
                            <>
                              μ{(c.format ?? fmt)(distribution.mean)} · p90{" "}
                              {(c.format ?? fmt)(distribution.p90)} · p99{" "}
                              {(c.format ?? fmt)(distribution.p99)}
                            </>
                          )}
                        </span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
