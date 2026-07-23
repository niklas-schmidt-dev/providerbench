import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { ComparisonTable } from "@/components/comparison-table";
import { MetricBarChart } from "@/components/metric-bar-chart";
import { SampleBanner } from "@/components/sample-banner";
import { CATEGORIES } from "@/lib/categories";
import { anySample, loadRuns, metricOf, type Run } from "@/lib/data";
import { metricSeries } from "@/lib/series";
import { PROVIDERS } from "@/lib/providers";


export default function Home() {
  const runs = loadRuns();
  const sample = anySample(runs);
  const providerCount = new Set(runs.map((r) => r.provider.name)).size;
  const updated = runs.map((r) => r.created_at).sort().at(-1);

  return (
    <main className="mx-auto max-w-7xl px-4 sm:px-6">
      {/* Title row — the page starts with the data, not a pitch. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Cloud provider benchmarks
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {providerCount} providers · 17 metrics per run · updated{" "}
            {updated
              ? new Date(updated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "—"}
          </p>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Reproduce any number:{" "}
          <Link href="/cli" className="font-mono text-[12px] text-brand hover:underline">
            providerbench run
          </Link>
        </p>
      </div>

      {sample && (
        <div className="mt-4">
          <SampleBanner />
        </div>
      )}

      {/* Leaderboard charts */}
      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <MetricBarChart title="CPU · single core" unit="MB/s" higherIsBetter data={metricSeries(runs, "cpu", "single_core_hash")} />
        <MetricBarChart title="CPU · all cores" unit="MB/s" higherIsBetter data={metricSeries(runs, "cpu", "multi_core_hash")} />
        <MetricBarChart title="Disk · random 4K read" unit="IOPS" higherIsBetter data={metricSeries(runs, "disk", "rand_read_4k")} />
        <MetricBarChart title="Network · download" unit="Mbps" higherIsBetter data={metricSeries(runs, "network", "download")} />
        <MetricBarChart
          title="CPU steal time"
          unit="%"
          higherIsBetter={false}
          data={metricSeries(runs, "steal", "cpu_steal")}
          note="CPU time the hypervisor gave to other tenants while all cores were saturated. Above ~2% sustained = oversold."
        />
        <MetricBarChart
          title="Disk · fsync latency"
          unit="ms"
          higherIsBetter={false}
          data={metricSeries(runs, "disk", "fsync_latency_p50")}
          note="Small write + flush to stable storage — what every database commit waits on."
        />
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        <Link href="/compute" className="text-brand hover:underline">
          All 17 compute metrics →
        </Link>
      </p>

      {/* Comparison table */}
      <h2 className="mt-10 text-[15px] font-semibold text-foreground">Full comparison</h2>
      <div className="mt-3">
        <ComparisonTable runs={runs} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Every value links back to a raw JSON report in{" "}
        <a
          href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results"
          className="font-mono text-brand hover:underline"
        >
          data/results/
        </a>
        , including full system info for verification.
      </p>

      {/* Categories + install, one quiet strip */}
      <div className="mt-10 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
          <span className="text-muted-foreground">Categories:</span>
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="group inline-flex items-center gap-1.5 text-foreground/85 hover:text-foreground"
            >
              {c.name}
              {c.status === "live" ? (
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
              ) : (
                <span className="text-[11px] text-muted-foreground">planned</span>
              )}
            </Link>
          ))}
          <span className="text-muted-foreground">·</span>
          {PROVIDERS.map((p) => (
            <Link
              key={p.slug}
              href={`/providers/${p.slug}`}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <CompanyLogo company={p.company} size="xs" decorative />
              {p.name}
            </Link>
          ))}
        </div>
        <code className="w-fit rounded-md border bg-card px-3 py-1.5 font-mono text-[12px] text-muted-foreground">
          go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest
        </code>
      </div>
    </main>
  );
}
