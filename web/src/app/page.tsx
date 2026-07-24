import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { ComparisonTable } from "@/components/comparison-table";
import { SectionHeading } from "@/components/section-heading";
import { MetricChart } from "@/components/metric-chart";
import { PricePerformanceChart } from "@/components/price-performance-chart";
import { SampleBanner } from "@/components/sample-banner";
import {
  aggregateRuns,
  bestGroupPerProvider,
  bestRegionPerPlan,
  currentScoredGroups,
} from "@/lib/aggregate";
import { CATEGORIES } from "@/lib/categories";
import { anySample, loadRuns } from "@/lib/data";
import { PROVIDERS } from "@/lib/providers";


export default function Home() {
  const runs = loadRuns();
  const scored = currentScoredGroups(aggregateRuns(runs));
  const plans = bestRegionPerPlan(scored);
  const providerLeaders = bestGroupPerProvider(scored);
  const sample = anySample(runs);
  const providerCount = new Set(runs.map((r) => r.provider.name)).size;
  const hostCount = scored.reduce((sum, group) => sum + group.hostCount, 0);
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
            {providerCount} providers · {hostCount} independent hosts · updated{" "}
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

      <div className="mt-6">
        <PricePerformanceChart groups={plans} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ["P50 is the headline", "The median across fresh hosts, never a cherry-picked VM."],
          ["P90 / P99 stay visible", "Tail behavior is shown beside the mean and median."],
          ["10 hosts to rank", "Smaller campaigns remain visible, faded, and provisional."],
        ].map(([title, body]) => (
          <div
            key={title}
            className="rounded-xl border bg-card px-4 py-3"
          >
            <p className="text-[12px] font-medium text-foreground">{title}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
        ))}
      </div>

      {/* Provider leaders: one best-region, best-performing plan per company. */}
      <SectionHeading
        className="mt-12"
        title="Best measured configuration per provider"
        meta={
          <p className="text-[11.5px] text-muted-foreground">
            selected by composite P50 · best region median, not best single host
          </p>
        }
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MetricChart groups={providerLeaders} test="cpu" metric="single_core_hash" />
        <MetricChart groups={providerLeaders} test="cpu" metric="multi_core_hash" />
        <MetricChart groups={providerLeaders} test="disk" metric="rand_read_4k" />
        <MetricChart groups={providerLeaders} test="network" metric="download" />
        <MetricChart groups={providerLeaders} test="steal" metric="cpu_steal" />
        <MetricChart groups={providerLeaders} test="disk" metric="fsync_latency_p50" />
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        <Link href="/compute" className="text-brand hover:underline">
          All 17 compute metrics →
        </Link>
      </p>

      {/* Comparison table */}
      <SectionHeading
        className="mt-12 mb-3"
        title="Every measured plan"
        description="One row per plan using its strongest independently sampled region. Provider pages keep the full location breakdown."
      />
      <div className="mt-3">
        <ComparisonTable groups={plans} />
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
