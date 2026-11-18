import Link from "next/link";

import { CategoryBar } from "@/components/category-bar";
import { CodeBlock } from "@/components/code-block";
import { CohortLedger } from "@/components/cohort-ledger";
import { CompanyLogo } from "@/components/company-logo";
import { BarCompare, type BarCompareRow } from "@/components/ds/bar-compare";
import { DsCard } from "@/components/ds/card";
import { MetricStat } from "@/components/ds/metric-stat";
import { Freshness, SectionHead } from "@/components/ds/section-head";
import { Leaderboard } from "@/components/leaderboard";
import { MetricChart } from "@/components/metric-chart";
import { PricePerformanceChart } from "@/components/price-performance-chart";
import { SampleBanner } from "@/components/sample-banner";
import { ValueChart } from "@/components/value-chart";
import {
  aggregateRuns,
  bestGroupPerProvider,
  bestRegionPerPlan,
  currentScoredGroups,
  metricSummary,
  SCORE_METRICS,
  type ScoredGroup,
} from "@/lib/aggregate";
import { CATEGORIES } from "@/lib/categories";
import { anySample, loadRuns } from "@/lib/data";
import { formatMetricValue } from "@/lib/format";
import { getMetricDef, TEST_SUMMARIES } from "@/lib/metrics";
import { PROVIDERS, providerColor, providerLabel } from "@/lib/providers";

const SUITE_LABELS: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  network: "Network",
  steal: "Consistency & steal",
};

const RULES: Array<[string, string]> = [
  ["Account", "Pay-as-you-go, no negotiated pricing, no vendor contact. Net EUR, excl. VAT."],
  ["Hosts", "Fresh instances only — a plan enters the ranking with its complete 10-host cohort."],
  ["Repeats", "3 repeats per host, reduced to one host median before cross-host statistics."],
  ["Statistic", "The headline is the cross-host P50 — never a cherry-picked machine."],
  ["Tails", "Mean, P10, P90 and P99 publish beside every median. Variance is the product."],
  ["Exclusions", "Failed suites invalidate the composite. Errors are reported, never imputed."],
];

function metricRows(
  groups: ScoredGroup[],
  test: string,
  metric: string,
  lowerIsBetter = false,
): BarCompareRow[] {
  return groups
    .flatMap((group) => {
      const name = group.provider.name;
      const value = metricSummary(group, test, metric)?.distribution.p50;
      if (!name || value === undefined) return [];
      return [
        {
          label: providerLabel(name),
          value,
          display: formatMetricValue(value),
          color: providerColor(name),
          faded: !group.rankEligible,
        },
      ];
    })
    .sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value))
    .slice(0, 5);
}

export default function Home() {
  const runs = loadRuns();
  const scored = currentScoredGroups(aggregateRuns(runs));
  const plans = bestRegionPerPlan(scored);
  const providerLeaders = bestGroupPerProvider(scored);
  const sample = anySample(runs);
  const providerCount = new Set(runs.map((r) => r.provider.name)).size;
  const hostCount = scored.reduce((sum, group) => sum + group.hostCount, 0);
  const runCount = runs.length;
  const updated = runs.map((r) => r.created_at).sort().at(-1);
  const updatedLabel = updated
    ? new Date(updated).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

  // The homepage reports on the live category — today that is compute.
  const liveCategory = CATEGORIES.find((c) => c.status === "live")!;
  const report = liveCategory.report!;

  // The combination, not the raw price: composite work per euro, best = 100.
  const valueRows: BarCompareRow[] = plans
    .flatMap((group) => {
      const name = group.provider.name;
      if (!name || group.valueIndex === undefined) return [];
      return [
        {
          label: group.provider.plan
            ? `${providerLabel(name)} ${group.provider.plan}`
            : providerLabel(name),
          value: group.valueIndex,
          display: String(Math.round(group.valueIndex)),
          color: providerColor(name),
          faded: !group.rankEligible,
        },
      ];
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // Scoring weights, grouped by suite for the method card.
  const weightBySuite = [...SCORE_METRICS.reduce((acc, m) => {
    acc.set(m.test, (acc.get(m.test) ?? 0) + m.weight);
    return acc;
  }, new Map<string, number>())]
    .map(([test, weight]) => ({ test, weight: Math.round(weight * 100) }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <main>
      {/* ——— Dark instrument hero ——— */}
      <section className="hero-dark">
        <div className="mx-auto flex max-w-(--content-max) flex-wrap items-end gap-x-10 gap-y-10 px-4 pt-12 pb-10 sm:px-8 lg:pt-16">
          <div className="min-w-[300px] flex-[1.4]">
            <span className="pb-label inline-flex items-center gap-[7px] text-signal">
              <span aria-hidden className="led size-1.5 rounded-full bg-signal" />
              Live leaderboard · open benchmark
            </span>
            <h1 className="mt-4 text-[40px] leading-[44px] font-semibold tracking-[-0.025em] text-gray-0 sm:text-[56px] sm:leading-[56px] sm:tracking-[-0.03em]">
              Measured,
              <br />
              <span className="text-signal">not marketed.</span>
            </h1>
            <p className="mt-5 max-w-[560px] text-[15px] leading-[23px] text-gray-400">
              Every provider sells &ldquo;vCPUs&rdquo; and &ldquo;NVMe&rdquo;.
              None of them sell you the numbers that matter: hypervisor steal
              under load, run-to-run variance, the real cost of an fsync. We
              measure all of it on fresh hosts with one open harness — and
              publish every sample as raw JSON anyone can reproduce, or dispute.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/cli"
                className="inline-flex h-[42px] items-center rounded-(--radius-sm) bg-(--action-signal-bg) px-5 text-[15px] font-medium tracking-[-0.01em] text-(--action-signal-fg) transition-colors hover:bg-(--action-signal-bg-hover)"
              >
                Run the benchmark
              </Link>
              <a
                href="#board"
                className="inline-flex h-[42px] items-center rounded-(--radius-sm) border border-(--border-inverse) px-5 text-[15px] font-medium tracking-[-0.01em] text-gray-0 transition-colors hover:bg-gray-900"
              >
                Read the measurements ↓
              </a>
            </div>
          </div>
          <div className="grid min-w-[280px] flex-1 grid-cols-2 gap-x-7 gap-y-6 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
            <MetricStat inverse label="Providers" value={String(providerCount).padStart(2, "0")} note="independent vendors" />
            <MetricStat inverse label="Host observations" value={String(hostCount)} note="fresh instances" />
            <MetricStat inverse label="Raw runs" value={String(runCount)} note="3 repeats per host" />
            <MetricStat inverse label="Dataset updated" value={updatedLabel} note="UTC timestamps" />
          </div>
        </div>
      </section>

      <CategoryBar
        active={liveCategory.slug}
        right={
          <div className="py-[7px]">
            <Freshness>
              Every sample published as raw JSON · updated {updatedLabel}
            </Freshness>
          </div>
        }
      />

      <div className="mx-auto grid max-w-(--content-max) gap-6 px-4 pt-8 pb-4 sm:px-8">
        {sample && <SampleBanner />}

        {/* ——— Highlight cards ——— */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
          <DsCard padding="16px">
            <div className="pb-label mb-3 text-muted-foreground">
              CPU · all cores (P50)
            </div>
            <BarCompare
              unit="MB/s"
              labelWidth={92}
              barHeight={8}
              rows={metricRows(providerLeaders, "cpu", "multi_core_hash")}
            />
            <div className="mt-3 text-[12px] text-(--text-faint)">
              Higher is better · best configuration per provider
            </div>
          </DsCard>
          <DsCard padding="16px">
            <div className="pb-label mb-3 text-muted-foreground">
              Network · download (P50)
            </div>
            <BarCompare
              unit="Mbps"
              labelWidth={92}
              barHeight={8}
              rows={metricRows(providerLeaders, "network", "download")}
            />
            <div className="mt-3 text-[12px] text-(--text-faint)">
              Higher is better · nearest neutral edge
            </div>
          </DsCard>
          <DsCard padding="16px">
            <div className="pb-label mb-3 text-muted-foreground">
              Value · work per €100
            </div>
            <BarCompare
              labelWidth={118}
              barHeight={8}
              rows={valueRows}
            />
            <div className="mt-3 text-[12px] text-(--text-faint)">
              Composite score per euro · best-value plan = 100
            </div>
          </DsCard>
        </div>

        {/* ——— The board ——— */}
        <DsCard
          flush
          id="board"
          className="scroll-mt-24"
          title={`The board — ${liveCategory.name}`}
          subtitle="Ranked by composite cross-host P50 · best region median per plan"
          actions={
            <Link
              href={`/${liveCategory.slug}`}
              className="inline-flex h-7 items-center rounded-(--radius-sm) border border-(--border-strong) bg-card px-2.5 text-[13px] font-medium text-foreground shadow-(--shadow-xs) transition-colors hover:bg-(--surface-hover)"
            >
              Full comparison →
            </Link>
          }
          footer={
            <>
              Provisional campaigns rank only once their complete 10-host × 3-repeat
              cohort lands — smaller campaigns stay visible, faded.
            </>
          }
        >
          <Leaderboard
            groups={plans}
            spotlight={[
              { test: "cpu", metric: "multi_core_hash", shortLabel: "CPU all" },
              { test: "network", metric: "download", shortLabel: "Download" },
            ]}
          />
        </DsCard>

        {/* ——— Value: what the money actually buys ——— */}
        <SectionHead
          className="mt-10"
          eyebrow="Work per euro"
          title="What €100 actually buys"
          note="Neither the price column nor the score column answers the question alone. This is the combination: measured composite work per euro of list price — and, per plan, how many times more you pay against how much more work you get."
        />
        <ValueChart groups={plans} />
        <PricePerformanceChart groups={plans} />

        {/* ——— Signals ——— */}
        <SectionHead
          className="mt-10"
          eyebrow="Signals"
          title="Best configuration per provider"
          note="One headline chart per suite — composite P50, best region median."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          {report.leaderCharts.map((ref) => (
            <MetricChart
              key={`${ref.test}.${ref.metric}`}
              groups={providerLeaders}
              test={ref.test}
              metric={ref.metric}
            />
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">
          <Link
            href={`/${liveCategory.slug}`}
            className="border-b border-(--border-strong) text-foreground hover:border-foreground"
          >
            All 16 compute metrics →
          </Link>
        </p>

        {/* ——— The evidence trail ——— */}
        <SectionHead
          className="mt-10"
          eyebrow="Provenance"
          title="The evidence trail"
          note="Every number above exists as a dated raw report in the public dataset. Dispute anything: rerun the same plan and open a PR."
        />
        <CohortLedger groups={plans} limit={8} />
        <p className="font-mono text-[11.5px] text-muted-foreground">
          Full dataset:{" "}
          <a
            href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results"
            className="border-b border-(--border-strong) text-foreground hover:border-foreground"
          >
            data/results/
          </a>{" "}
          — one JSON file per run, full system info included.
        </p>

        {/* ——— The method ——— */}
        <SectionHead
          className="mt-10"
          eyebrow="Methodology"
          title="How the numbers are made"
          note={
            <>
              The harness is one static Go binary; suites are deterministic and
              open.{" "}
              <a
                href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/internal/tests"
                className="border-b border-(--border-strong) text-foreground hover:border-foreground"
              >
                Read the benchmark code →
              </a>
            </>
          }
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <DsCard title="How providers are measured">
            {RULES.map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-[110px_1fr] gap-4 border-b border-(--border-hairline) py-[9px] last:border-b-0"
              >
                <span className="pb-label pt-0.5 text-muted-foreground">{k}</span>
                <span className="text-[13.5px] leading-[20px] text-(--text-body)">{v}</span>
              </div>
            ))}
          </DsCard>
          <DsCard
            title="Scoring"
            subtitle="How the 0–100 composite is derived — geometric mean, weighted by suite"
          >
            <div className="grid gap-3 pt-1">
              {weightBySuite.map(({ test, weight }) => (
                <div
                  key={test}
                  className="grid grid-cols-[1fr_42px] items-center gap-x-3 gap-y-1"
                >
                  <span className="text-[13.5px] text-(--text-body)">
                    {SUITE_LABELS[test] ?? test}
                  </span>
                  <span className="pb-num text-right text-[13px] text-foreground">
                    {weight}%
                  </span>
                  <span className="col-span-full h-1 rounded-[2px] bg-(--bar-track)">
                    <span
                      className="block h-1 rounded-[2px] bg-gray-950"
                      style={{ width: `${Math.min(100, weight * 2)}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12px] leading-[18px] text-muted-foreground">
              {TEST_SUMMARIES.steal}
            </p>
          </DsCard>
        </div>

        {/* ——— Install + providers ——— */}
        <div className="mt-10 grid gap-8 border-t border-(--border-hairline) pt-8 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="pb-label text-muted-foreground">Install the instrument</p>
            <div className="mt-3">
              <CodeBlock title="one static binary · no account">
                {`go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest`}
              </CodeBlock>
            </div>
          </div>
          <div>
            <p className="pb-label text-muted-foreground">Providers on the bench</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              {PROVIDERS.map((p) => (
                <Link
                  key={p.slug}
                  href={`/providers/${p.slug}`}
                  className="inline-flex items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CompanyLogo company={p.company} size="xs" decorative />
                  {p.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
