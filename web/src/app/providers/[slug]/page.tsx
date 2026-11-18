import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { DsBadge } from "@/components/ds/badge";
import { DsCard } from "@/components/ds/card";
import { DeltaValue } from "@/components/ds/delta-value";
import { MetricStat } from "@/components/ds/metric-stat";
import { LocationComparison } from "@/components/location-comparison";
import { PerformanceHistoryChart } from "@/components/performance-history-chart";
import { PricePerformanceChart } from "@/components/price-performance-chart";
import { SampleBanner } from "@/components/sample-banner";
import {
  aggregateRuns,
  bestGroupPerProvider,
  bestRegionPerPlan,
  currentScoredGroups,
  metricSummary,
  scoreGroups,
  type ScoredGroup,
  type TestSummary,
} from "@/lib/aggregate";
import { getCategory } from "@/lib/categories";
import { allSample, loadRuns, runsForProvider } from "@/lib/data";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue } from "@/lib/format";
import { getProvider, PROVIDERS } from "@/lib/providers";

export const dynamicParams = false;

export function generateStaticParams() {
  const withRuns = new Set(loadRuns().map((run) => run.provider.name));
  return PROVIDERS.filter((provider) => withRuns.has(provider.slug)).map(
    (provider) => ({ slug: provider.slug }),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const provider = getProvider((await params).slug);
  return {
    title: provider.name,
    description: `Aggregated ProviderBench results for ${provider.name}.`,
  };
}

function bestOf(
  peers: ScoredGroup[],
  test: string,
  metric: string,
  higherIsBetter: boolean,
) {
  const values = peers.flatMap((group) => {
    const value = metricSummary(group, test, metric)?.distribution.p50;
    return value === undefined ? [] : [value];
  });
  if (values.length === 0) return undefined;
  return higherIsBetter ? Math.max(...values) : Math.min(...values);
}

function TestCard({ result, peers }: { result: TestSummary; peers: ScoredGroup[] }) {
  return (
    <DsCard
      flush
      title={
        <a
          href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/internal/tests/compute/${result.test}.go`}
          className="font-mono text-[14px] hover:underline"
          title="benchmark source code"
        >
          {result.test}
        </a>
      }
      actions={
        <span className="pb-label text-[10px] text-(--text-faint)">
          measured {formatMeasurementWindow(result.measuredFrom, result.measuredTo)}
        </span>
      }
      footer={
        result.notes.length > 0 ? (
          <span className="text-[11.5px] leading-[17px]">{result.notes.join(" · ")}</span>
        ) : undefined
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {["Metric", "P50", "Mean", "P10", "P90", "P99", "vs best"].map((h, i) => (
                <th
                  key={h}
                  className="pb-label h-8 border-b border-(--border-hairline) px-(--pad-cell-x) whitespace-nowrap text-muted-foreground"
                  style={{ textAlign: i === 0 ? "left" : "right" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.metrics.map((metric) => {
              const distribution = metric.distribution;
              const best = bestOf(peers, result.test, metric.name, metric.higherIsBetter);
              const isBest = best !== undefined && distribution.p50 === best;
              const gap =
                best === undefined || best === 0 || isBest
                  ? 0
                  : metric.higherIsBetter
                    ? (1 - distribution.p50 / best) * 100
                    : (distribution.p50 / best - 1) * 100;
              return (
                <tr
                  key={metric.name}
                  className="border-b border-(--border-hairline) last:border-b-0"
                >
                  <td className="px-(--pad-cell-x) py-2 font-mono text-[12px] text-muted-foreground">
                    {metric.name}
                  </td>
                  {[
                    distribution.p50,
                    distribution.mean,
                    distribution.p10,
                    distribution.p90,
                    distribution.p99,
                  ].map((value, index) => (
                    <td
                      key={index}
                      className="pb-num px-(--pad-cell-x) py-2 text-right text-[12px] text-foreground"
                    >
                      {formatMetricValue(value)}
                      {index === 0 && (
                        <span className="ml-1 text-(--text-faint)">{metric.unit}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-(--pad-cell-x) py-2 text-right whitespace-nowrap">
                    {isBest ? (
                      <DsBadge tone="pass">best</DsBadge>
                    ) : best !== undefined ? (
                      <DeltaValue value={-gap} decimals={0} showArrow={false} />
                    ) : (
                      <span className="text-(--text-faint)">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </DsCard>
  );
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const provider = getProvider(slug);
  const rawRuns = runsForProvider(slug);
  if (rawRuns.length === 0) notFound();

  const aggregated = aggregateRuns(loadRuns());
  // Current plan cards use the same current-only normalization as the main
  // comparison. History gets its own stable all-cohort normalization.
  const allGroups = currentScoredGroups(aggregated);
  const allCohorts = scoreGroups(aggregated);
  const groups = allGroups.filter((group) => group.provider.name === slug);
  const history = allCohorts.filter((group) => group.provider.name === slug);
  const planLeaders = bestRegionPerPlan(groups);
  const globalPlanLeaders = bestRegionPerPlan(allGroups);
  const observationCount = groups.reduce((sum, group) => sum + group.hostCount, 0);
  const auditRuns = rawRuns.filter(
    (run) =>
      !run.manifest.rank_eligible ||
      run.results.some((result) => Boolean(result.error)),
  );

  const providerLeaders = bestGroupPerProvider(allGroups)
    .filter((g) => g.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const rank = providerLeaders.findIndex((g) => g.provider.name === slug) + 1;
  const bestGroup = [...groups].sort(
    (a, b) => b.performanceScore - a.performanceScore,
  )[0];
  const minPrice = Math.min(
    ...groups.flatMap((g) => (g.provider.price_eur_month ? [g.provider.price_eur_month] : [])),
  );
  const sinceYear = rawRuns
    .map((r) => new Date(r.created_at).getUTCFullYear())
    .sort()[0];

  return (
    <main>
      {/* ——— Identity hero ——— */}
      <section className="border-b border-(--border-hairline) bg-card">
        <div className="mx-auto max-w-(--content-max) px-4 pt-6 sm:px-8">
          <div className="mb-3.5 text-[12.5px] text-(--text-faint)">
            <Link href="/providers" className="hover:text-foreground">
              Providers
            </Link>{" "}
            / {provider.name}
          </div>
          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-[280px] flex-1">
              <div className="flex flex-wrap items-center gap-3">
                {provider.company && (
                  <CompanyLogo company={provider.company} size="sm" decorative />
                )}
                <h1 className="text-[34px] leading-[40px] font-semibold tracking-[-0.025em] text-foreground sm:text-[40px] sm:leading-[44px]">
                  {provider.name}
                </h1>
                <span
                  aria-hidden
                  className="size-2.5 rounded-[3px]"
                  style={{ background: provider.color }}
                />
                {sinceYear && (
                  <DsBadge tone="pass" dot>
                    Measured since {sinceYear}
                  </DsBadge>
                )}
                {rank > 0 && <DsBadge tone="neutral">#{rank} of {providerLeaders.length} on the composite</DsBadge>}
              </div>
              <p className="mt-2.5 max-w-[620px] text-[15px] leading-[23px] text-muted-foreground">
                {provider.blurb}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {provider.website && (
                <a
                  href={provider.website}
                  className="inline-flex h-[34px] items-center gap-1.5 rounded-(--radius-sm) border border-(--border-strong) bg-card px-3.5 text-[14px] font-medium text-foreground shadow-(--shadow-xs) transition-colors hover:bg-(--surface-hover)"
                >
                  {provider.website.replace("https://", "")}
                  <ArrowUpRight className="size-3.5 text-(--text-faint)" />
                </a>
              )}
              <Link
                href="/compute"
                className="inline-flex h-[34px] items-center rounded-(--radius-sm) bg-(--action-solid-bg) px-3.5 text-[14px] font-medium text-(--action-solid-fg) transition-colors hover:bg-(--action-solid-bg-hover)"
              >
                Compare in Compute
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6 py-6 sm:grid-cols-3 lg:grid-cols-6">
            <MetricStat
              label="Best score"
              value={bestGroup ? bestGroup.performanceScore.toFixed(1) : "—"}
              accent={provider.color}
              note={bestGroup?.provider.plan ?? undefined}
            />
            <MetricStat
              label="Value index"
              value={bestGroup?.valueIndex?.toFixed(1) ?? "—"}
            />
            <MetricStat label="Fresh hosts" value={String(observationCount)} />
            <MetricStat label="Raw runs" value={String(rawRuns.length)} />
            <MetricStat label="Plans measured" value={String(planLeaders.length)} />
            <MetricStat
              label="From € / mo"
              value={Number.isFinite(minPrice) ? minPrice.toFixed(2) : "—"}
              note="net, excl. VAT"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-(--content-max) gap-6 px-4 pt-8 pb-4 sm:px-8">
        {allSample(rawRuns) && <SampleBanner />}

        {auditRuns.length > 0 && (
          <DsCard
            title="Audit reports"
            subtitle="Preserved for traceability, but excluded from ranking by the validator-owned manifest."
          >
            <ul className="grid gap-2 pt-1 text-[12.5px]">
              {auditRuns.map((run) => {
                const failures = run.results
                  .filter((result) => result.error)
                  .map((result) => `${result.test}: ${result.error}`);
                const reasons = [
                  ...(run.manifest.eligibility_reasons ?? []),
                  ...failures,
                ];
                return (
                  <li key={run.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <DsBadge tone="warn">excluded</DsBadge>
                    <a
                      href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${run.slug}.json`}
                      className="border-b border-(--border-strong) font-mono text-[12px] text-foreground hover:border-foreground"
                    >
                      {run.slug}.json
                    </a>
                    <span className="text-muted-foreground">
                      {reasons.join(" · ") || "not ranking-eligible"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </DsCard>
        )}

        <PricePerformanceChart groups={planLeaders} />

        <PerformanceHistoryChart groups={history} />

        <LocationComparison groups={groups} />

        {groups.map((group) => {
          const category = getCategory(group.category);
          const peers = globalPlanLeaders.filter(
            (peer) => peer.category === group.category,
          );
          return (
            <section key={group.id} className="mt-8">
              <div className="flex flex-wrap items-center gap-2.5 border-t border-(--border-hairline) pt-5">
                <h2 className="text-[22px] leading-7 font-semibold tracking-[-0.015em] text-foreground">
                  {group.provider.plan}
                </h2>
                {group.provider.tier && <DsBadge tone="neutral">{group.provider.tier}</DsBadge>}
                {group.provider.product && (
                  <DsBadge tone="neutral">{group.provider.product}</DsBadge>
                )}
                <DsBadge tone="outline" mono>
                  {group.provider.region}
                </DsBadge>
                <DsBadge tone="info" mono>
                  measured {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
                </DsBadge>
                <DsBadge tone="outline" mono>
                  {group.protocolVersion} · {group.profile}
                </DsBadge>
                {group.provider.price_eur_month ? (
                  <DsBadge tone="outline" mono>
                    €{group.provider.price_eur_month.toFixed(2)}/mo
                    {group.provider.price_eur_hour
                      ? ` · €${group.provider.price_eur_hour.toFixed(4)}/h`
                      : ""}
                  </DsBadge>
                ) : null}
                <DsBadge tone={group.rankEligible ? "pass" : "warn"} dot>
                  {group.rankEligible ? "ranked" : "provisional"} · {group.hostCount}{" "}
                  {group.hostCount === 1 ? "host" : "hosts"}
                </DsBadge>
                <Link
                  href={`/${group.category}`}
                  className="ml-auto text-[13px] font-medium text-foreground hover:underline"
                >
                  Compare in {category?.name ?? group.category} →
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-(--border-hairline) bg-(--border-hairline) sm:grid-cols-4">
                {(
                  [
                    ["Score", group.performanceScore.toFixed(1)],
                    ["Value index", group.valueIndex?.toFixed(1) ?? "—"],
                    ["Independent hosts", String(group.hostCount)],
                    ["Raw runs", String(group.runCount)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <p className="pb-label text-[10px] text-muted-foreground">{label}</p>
                    <p className="pb-num mt-1.5 text-[18px] text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-md border border-(--border-hairline) bg-card px-5 py-4 shadow-(--shadow-xs)">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["CPU", group.system.cpu_model || "—"],
                    ["Cores", String(group.system.cpu_cores)],
                    [
                      "Memory",
                      group.system.mem_total_mb
                        ? `${(group.system.mem_total_mb / 1024).toFixed(0)} GiB`
                        : "—",
                    ],
                    ["OS / arch", `${group.system.os}/${group.system.arch}`],
                    ["Kernel", group.system.kernel || "—"],
                    ["CLI", group.representative.cli_version],
                    ...Object.entries(group.environment ?? {}),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="pb-label text-[10px] text-muted-foreground">{label}</dt>
                      <dd
                        className="mt-1 truncate font-mono text-[12px] text-foreground"
                        title={value}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
                {group.results.map((result) => (
                  <TestCard key={result.test} result={result} peers={peers} />
                ))}
              </div>

              <details className="group mt-3">
                <summary className="pb-label flex cursor-pointer items-center gap-2 text-[10.5px] text-muted-foreground transition-colors select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className="inline-block transition-transform group-open:rotate-90"
                  >
                    ▸
                  </span>
                  {group.runs.length} raw reports · P99 is a descriptive observed-tail
                  estimate for the fixed {group.hostCount}-host standard profile
                </summary>
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 border-l border-(--border-hairline) pl-4 font-mono text-[10.5px]">
                  {group.runs.map((run) => (
                    <a
                      key={run.slug}
                      href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${run.slug}.json`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {run.slug}.json
                    </a>
                  ))}
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </main>
  );
}
