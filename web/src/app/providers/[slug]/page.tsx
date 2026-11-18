import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { ProviderCharts } from "@/components/provider/provider-charts";
import { Badge } from "@/components/reui/badge";
import {
  aggregateRuns,
  bestGroupPerProvider,
  bestRegionPerPlan,
  currentScoredGroups,
  metricSummary,
  scoreGroups,
  type ScoredGroup,
} from "@/lib/aggregate";
import { allSample, loadRuns, runsForProvider } from "@/lib/data";
import { formatMeasurementWindow } from "@/lib/dates";
import { formatMetricValue } from "@/lib/format";
import { getMetricDef } from "@/lib/metrics";
import { priceLabel, rawReportUrl, sortPlans, sourceUrl, toPlanDatum } from "@/lib/plans";
import { getProvider, PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  const withRuns = new Set(loadRuns().map((run) => run.provider.name));
  return PROVIDERS.filter((provider) => withRuns.has(provider.slug)).map((provider) => ({ slug: provider.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const provider = getProvider((await params).slug);
  return {
    title: provider.name,
    description: `Aggregated ProviderBench results for ${provider.name}: every plan, region and raw report.`,
  };
}

function bestOf(peers: ScoredGroup[], test: string, metric: string, higherIsBetter: boolean) {
  const values = peers.flatMap((group) => {
    const value = metricSummary(group, test, metric)?.distribution.p50;
    return value === undefined ? [] : [value];
  });
  if (values.length === 0) return undefined;
  return higherIsBetter ? Math.max(...values) : Math.min(...values);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-subtle">{label}</dt>
      <dd className="text-[20px] leading-7 font-medium tracking-tight">{value}</dd>
      {note && <dd className="text-[12px] text-subtle">{note}</dd>}
    </div>
  );
}

function GroupDetail({ group, peers }: { group: ScoredGroup; peers: ScoredGroup[] }) {
  const facts = [
    group.provider.tier,
    group.provider.product,
    group.provider.region,
    `${group.system.cpu_cores} vCPU`,
    group.system.mem_total_mb ? `${Math.round(group.system.mem_total_mb / 1024)} GB RAM` : undefined,
    group.provider.price_eur_month
      ? `${priceLabel({ priceMonth: group.provider.price_eur_month, tier: group.provider.tier })} / mo`
      : undefined,
  ].filter(Boolean);

  return (
    <section aria-labelledby={`plan-${group.id}`} className="border-b border-border px-4 py-7 sm:px-7">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={`plan-${group.id}`} className="text-base font-medium tracking-tight">
          {group.provider.plan}
          {group.provider.region && <span className="ml-2 font-normal text-subtle">{group.provider.region}</span>}
        </h3>
        {group.rankEligible ? (
          <Badge variant="secondary">Ranked</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Provisional
          </Badge>
        )}
        <span className="text-[12px] text-subtle">{facts.join(" · ")}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-subtle">
        Score <span className="num text-foreground">{group.performanceScore.toFixed(1)}</span>
        {group.valueIndex !== undefined && (
          <>
            {" · "}value <span className="num text-foreground">{group.valueIndex.toFixed(0)}</span>
          </>
        )}
        {" · "}
        {group.hostCount} fresh hosts · {group.runCount} raw runs · {group.protocolVersion} · measured{" "}
        {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="text-[12px] text-subtle">
              {["Metric", "P50", "P10", "P90", "P99", "vs best"].map((heading, i) => (
                <th
                  key={heading}
                  scope="col"
                  className={cn("h-8 border-b border-border font-normal", i === 0 ? "text-left" : "text-right")}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          {group.results.map((result) => (
            <tbody key={result.test}>
              <tr>
                <th colSpan={6} scope="rowgroup" className="pt-4 pb-1 text-left text-[12px] font-medium">
                  <a
                    href={sourceUrl(group.category, result.test)}
                    className="font-mono underline decoration-border-strong underline-offset-3 transition-colors hover:decoration-foreground"
                  >
                    {result.test}
                  </a>
                  {result.notes.length > 0 && (
                    <span className="ml-2 font-normal text-subtle">{result.notes.join(" · ")}</span>
                  )}
                </th>
              </tr>
              {result.metrics.map((metric) => {
                const d = metric.distribution;
                const best = bestOf(peers, result.test, metric.name, metric.higherIsBetter);
                const isBest = best !== undefined && d.p50 === best;
                const gap =
                  best === undefined || best === 0 || isBest
                    ? 0
                    : metric.higherIsBetter
                      ? (d.p50 / best - 1) * 100
                      : (best / d.p50 - 1) * 100;
                const title = getMetricDef(result.test, metric.name)?.title;
                return (
                  <tr key={metric.name} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 pr-4 text-muted-foreground">{title ?? metric.name}</td>
                    {[d.p50, d.p10, d.p90, d.p99].map((value, index) => (
                      <td key={index} className={cn("num py-1.5 text-right", index === 0 ? "font-medium" : "text-muted-foreground")}>
                        {formatMetricValue(value)}
                        {index === 0 && <span className="ml-1 text-[11px] font-normal text-faint">{metric.unit}</span>}
                      </td>
                    ))}
                    <td className="num py-1.5 text-right">
                      {isBest ? (
                        <span className="font-medium">best</span>
                      ) : best !== undefined ? (
                        <span className="text-muted-foreground">{gap.toFixed(0)}%</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

export default async function ProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const provider = getProvider(slug);
  const rawRuns = runsForProvider(slug);
  if (rawRuns.length === 0) notFound();

  const aggregated = aggregateRuns(loadRuns());
  const allGroups = currentScoredGroups(aggregated);
  // History uses its own all-campaign normalization; headlines stay current-only.
  const history = scoreGroups(aggregated)
    .filter((group) => group.provider.name === slug)
    .sort((a, b) => b.measuredTo.localeCompare(a.measuredTo) || (a.provider.plan ?? "").localeCompare(b.provider.plan ?? ""));
  const groups = allGroups
    .filter((group) => group.provider.name === slug)
    .sort(
      (a, b) =>
        (a.provider.price_eur_month ?? Infinity) - (b.provider.price_eur_month ?? Infinity) ||
        (a.provider.region ?? "").localeCompare(b.provider.region ?? ""),
    );
  const currentIds = new Set(groups.map((group) => group.id));
  const planLeaders = bestRegionPerPlan(groups);
  const globalPlanLeaders = bestRegionPerPlan(allGroups);
  const order = PROVIDERS.map((p) => p.slug);
  const plans = sortPlans(planLeaders.map(toPlanDatum), order);
  const regions = sortPlans(groups.map(toPlanDatum), order);

  const providerLeaders = bestGroupPerProvider(allGroups)
    .filter((g) => g.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const rank = providerLeaders.findIndex((g) => g.provider.name === slug) + 1;
  const best = [...groups].sort((a, b) => b.performanceScore - a.performanceScore)[0];
  const cheapest = groups
    .filter((g) => g.provider.price_eur_month)
    .sort((a, b) => a.provider.price_eur_month! - b.provider.price_eur_month!)[0];
  const hosts = groups.reduce((sum, group) => sum + group.hostCount, 0);
  const auditRuns = rawRuns.filter(
    (run) => !run.manifest.rank_eligible || run.results.some((result) => Boolean(result.error)),
  );

  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-6 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">
          <Link href="/providers" className="transition-colors hover:text-foreground">
            Providers
          </Link>{" "}
          / {provider.name}
        </p>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              {provider.company && <CompanyLogo company={provider.company} size="lg" decorative />}
              <h1 className="text-[32px] leading-[38px] font-medium tracking-[-0.03em]">{provider.name}</h1>
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: provider.color }} />
            </div>
            <p className="max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">{provider.blurb}</p>
          </div>
          <div className="flex items-center gap-4 text-[13px]">
            {provider.website && (
              <a href={provider.website} className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                {provider.website.replace("https://", "")}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            )}
            <Link
              href="/"
              className="flex h-8 items-center rounded-md bg-foreground px-3 font-medium text-background transition-opacity hover:opacity-85"
            >
              Compare all providers
            </Link>
          </div>
        </div>
        <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
          <Stat
            label="Best score"
            value={best ? best.performanceScore.toFixed(1) : "—"}
            note={rank > 0 ? `#${rank} of ${providerLeaders.length} providers` : undefined}
          />
          <Stat label="Value index" value={best?.valueIndex?.toFixed(0) ?? "—"} note={best?.provider.plan} />
          <Stat label="Plans" value={String(planLeaders.length)} note={`${groups.length} region cohorts`} />
          <Stat label="Fresh hosts" value={String(hosts)} />
          <Stat label="Raw runs" value={String(rawRuns.length)} />
          <Stat
            label="From"
            value={cheapest ? `${priceLabel({ priceMonth: cheapest.provider.price_eur_month, tier: cheapest.provider.tier })}/mo` : "—"}
            note={cheapest?.provider.tier === "usage-based" ? "est. at 730 h full use" : "net, excl. VAT"}
          />
        </dl>
        {allSample(rawRuns) && (
          <p className="mt-5 text-[13px] text-muted-foreground">Sample data: illustrative, not measurements.</p>
        )}
      </header>

      {auditRuns.length > 0 && (
        <section aria-labelledby="audit-title" className="border-b border-border px-4 py-6 sm:px-7">
          <h2 id="audit-title" className="text-base font-medium tracking-tight">
            Audit reports
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Kept for traceability and excluded from ranking by the validator-owned manifest.
          </p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[12px]">
            {auditRuns.map((run) => {
              const reasons = [
                ...(run.manifest.eligibility_reasons ?? []),
                ...run.results.filter((r) => r.error).map((r) => `${r.test}: ${r.error}`),
              ];
              return (
                <li key={run.slug} className="flex flex-wrap gap-x-3">
                  <a href={rawReportUrl(`${run.slug}.json`)} className="font-mono underline decoration-border-strong underline-offset-3 hover:decoration-foreground">
                    {run.slug}.json
                  </a>
                  <span className="text-subtle">{reasons.join(" · ") || "not ranking-eligible"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ProviderCharts plans={plans} regions={regions} />

      <div className="px-4 pt-8 sm:px-7">
        <h2 className="text-base font-medium tracking-tight">Every cohort</h2>
        <p className="mt-0.5 max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
          Cross-host distributions per plan and region. &ldquo;vs best&rdquo; compares the P50 with the best plan on the
          bench.
        </p>
      </div>
      {groups.map((group) => (
        <GroupDetail
          key={group.id}
          group={group}
          peers={globalPlanLeaders.filter((peer) => peer.category === group.category)}
        />
      ))}

      <section aria-labelledby="history-title" className="px-4 py-7 sm:px-7">
        <h2 id="history-title" className="text-base font-medium tracking-tight">
          Campaign history
        </h2>
        <p className="mt-0.5 max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
          Every aggregated cohort, newest first, with each dated raw report. Campaigns are never pooled: the latest
          complete cohort drives the comparison above, older ones stay here; runs excluded from aggregation are listed
          under Audit reports. Scores in this table are normalized across all
          campaigns, so they can differ slightly from the current comparison. Rerun a plan and open a pull request to
          dispute a number.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="text-[12px] text-subtle">
                {["Campaign", "Plan", "Measured", "Protocol", "Hosts", "Score", "Status", "Raw reports"].map((heading, i) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn("h-8 border-b border-border pr-4 font-normal", i === 4 || i === 5 ? "text-right" : "text-left")}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((cohort) => {
                const status = !cohort.rankEligible ? "Not ranked" : currentIds.has(cohort.id) ? "Current" : "Superseded";
                return (
                  <tr key={cohort.id} className="border-b border-border align-top last:border-b-0">
                    <td className="py-2 pr-4 font-mono text-[12px] text-muted-foreground">{cohort.cohortId || "—"}</td>
                    <td className="py-2 pr-4">
                      {cohort.provider.plan}
                      {cohort.provider.region && <span className="ml-1.5 text-subtle">{cohort.provider.region}</span>}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {formatMeasurementWindow(cohort.measuredFrom, cohort.measuredTo)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[12px] text-muted-foreground">{cohort.protocolVersion}</td>
                    <td className="num py-2 pr-4 text-right">{cohort.hostCount}</td>
                    <td className="num py-2 pr-4 text-right">{cohort.performanceScore.toFixed(1)}</td>
                    <td className={cn("py-2 pr-4", status === "Current" ? "text-foreground" : "text-subtle")}>{status}</td>
                    <td className="py-2">
                      <details>
                        <summary className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground">
                          {cohort.runs.length} {cohort.runs.length === 1 ? "file" : "files"}
                        </summary>
                        <ul className="mt-1.5 flex flex-col gap-1">
                          {cohort.runs.map((run) => (
                            <li key={run.slug}>
                              <a
                                href={rawReportUrl(`${run.slug}.json`)}
                                className="font-mono text-[12px] underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
                              >
                                {run.slug}.json
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
