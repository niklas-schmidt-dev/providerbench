import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { metricOf, type Run } from "@/lib/data";
import { providerColor, providerLabel } from "@/lib/providers";
import Link from "next/link";

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

export function ComparisonTable({ runs }: { runs: Run[] }) {
  const bests = COLUMNS.map((c) => {
    const values = runs
      .map((r) => metricOf(r, c.test, c.metric)?.value)
      .filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return c.higherIsBetter ? Math.max(...values) : Math.min(...values);
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Provider / plan</TableHead>
            <TableHead className="text-right">€/mo</TableHead>
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
          {runs.map((run) => {
            const name = run.provider.name ?? run.slug;
            return (
              <TableRow key={run.slug}>
                <TableCell className="pl-4">
                  <Link
                    href={`/providers/${name}`}
                    className="flex items-center gap-2.5 hover:underline"
                  >
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: providerColor(name) }}
                    />
                    <span>
                      <span className="block text-[13px] font-medium">
                        {providerLabel(name)}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {run.provider.plan} · {run.provider.region} · {run.system.cpu_cores} vCPU
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {run.provider.price_eur_month ? run.provider.price_eur_month.toFixed(2) : "—"}
                </TableCell>
                {COLUMNS.map((c, i) => {
                  const m = metricOf(run, c.test, c.metric);
                  const isBest = m !== undefined && m.value === bests[i];
                  return (
                    <TableCell key={c.metric} className="text-right font-mono text-xs tabular-nums">
                      <span className={isBest ? "text-foreground" : "text-muted-foreground"}>
                        {m ? (c.format ?? fmt)(m.value) : "—"}
                      </span>
                      {isBest && (
                        <Badge
                          variant="secondary"
                          className="ml-1.5 h-4 px-1 text-[9px] text-success"
                        >
                          best
                        </Badge>
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
