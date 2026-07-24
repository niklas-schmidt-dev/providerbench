import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { LocationComparison } from "@/components/location-comparison";
import { PageHeader } from "@/components/page-header";
import { PerformanceHistoryChart } from "@/components/performance-history-chart";
import { PricePerformanceChart } from "@/components/price-performance-chart";
import { SampleBanner } from "@/components/sample-banner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  aggregateRuns,
  bestRegionPerPlan,
  currentScoredGroups,
  metricSummary,
  P99_RECOMMENDED_HOSTS,
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
    <Card className="gap-3">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="font-mono text-sm">
          <a
            href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/internal/tests/compute/${result.test}.go`}
            className="hover:text-brand hover:underline"
            title="benchmark source code"
          >
            {result.test}
          </a>
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          measured {formatMeasurementWindow(result.measuredFrom, result.measuredTo)}
        </span>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">Metric</TableHead>
              <TableHead className="h-8 text-right">P50</TableHead>
              <TableHead className="h-8 text-right">Mean</TableHead>
              <TableHead className="h-8 text-right">P10</TableHead>
              <TableHead className="h-8 text-right">P90</TableHead>
              <TableHead className="h-8 text-right">P99</TableHead>
              <TableHead className="h-8 text-right">vs best</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.metrics.map((metric) => {
              const distribution = metric.distribution;
              const best = bestOf(
                peers,
                result.test,
                metric.name,
                metric.higherIsBetter,
              );
              const isBest = best !== undefined && distribution.p50 === best;
              const gap =
                best === undefined || best === 0 || isBest
                  ? 0
                  : metric.higherIsBetter
                    ? (1 - distribution.p50 / best) * 100
                    : (distribution.p50 / best - 1) * 100;
              return (
                <TableRow key={metric.name}>
                  <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                    {metric.name}
                  </TableCell>
                  {[distribution.p50, distribution.mean, distribution.p10, distribution.p90, distribution.p99].map(
                    (value, index) => (
                      <TableCell
                        key={index}
                        className="py-2 text-right font-mono text-xs tabular-nums text-foreground"
                      >
                        {formatMetricValue(value)}
                        {index === 0 && (
                          <span className="ml-1 text-muted-foreground">
                            {metric.unit}
                          </span>
                        )}
                      </TableCell>
                    ),
                  )}
                  <TableCell className="py-2 text-right">
                    {isBest ? (
                      <Badge
                        variant="secondary"
                        className="h-5 px-1.5 text-[10px] text-success"
                      >
                        best
                      </Badge>
                    ) : best !== undefined ? (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        −{gap.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {result.notes.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {result.notes.join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
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
  const observationCount = groups.reduce(
    (sum, group) => sum + group.hostCount,
    0,
  );

  return (
    <main>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {provider.company && (
              <CompanyLogo company={provider.company} size="xs" decorative />
            )}
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: provider.color }}
            />
            Providers / {provider.name}
          </span>
        }
        title={provider.name}
        lede={provider.blurb}
      >
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {provider.website && (
            <a
              href={provider.website}
              className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline"
            >
              {provider.website.replace("https://", "")}
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
          <Badge variant="outline" className="font-mono text-muted-foreground">
            {observationCount} fresh-host{" "}
            {observationCount === 1 ? "observation" : "observations"}
          </Badge>
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {allSample(rawRuns) && (
          <div className="mt-8">
            <SampleBanner />
          </div>
        )}

        <div className="mt-8">
          <PricePerformanceChart groups={planLeaders} />
        </div>

        <PerformanceHistoryChart groups={history} />

        <LocationComparison groups={groups} />

        {groups.map((group) => {
          const category = getCategory(group.category);
          const peers = globalPlanLeaders.filter(
            (peer) => peer.category === group.category,
          );
          return (
            <section key={group.id} className="mt-14">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-semibold text-foreground">
                  {group.provider.plan}
                </h2>
                {group.provider.tier && (
                  <Badge variant="secondary" className="font-mono font-normal">
                    {group.provider.tier}
                  </Badge>
                )}
                {group.provider.product && (
                  <Badge variant="secondary" className="font-normal">
                    {group.provider.product}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="font-mono font-normal text-muted-foreground"
                >
                  {group.provider.region}
                </Badge>
                <Badge
                  variant="outline"
                  className="font-mono font-normal text-brand"
                >
                  measured{" "}
                  {formatMeasurementWindow(group.measuredFrom, group.measuredTo)}
                </Badge>
                {group.provider.price_eur_month ? (
                  <Badge
                    variant="outline"
                    className="font-mono font-normal text-muted-foreground"
                  >
                    €{group.provider.price_eur_month.toFixed(2)}/mo
                    {group.provider.price_eur_hour
                      ? ` · €${group.provider.price_eur_hour.toFixed(4)}/h`
                      : ""}
                  </Badge>
                ) : null}
                <Badge
                  variant="outline"
                  className={
                    group.rankEligible
                      ? "font-mono font-normal text-success"
                      : "font-mono font-normal text-warning"
                  }
                >
                  {group.rankEligible ? "ranked" : "provisional"} · {group.hostCount}{" "}
                  {group.hostCount === 1 ? "host" : "hosts"}
                </Badge>
                <Link
                  href={`/${group.category}`}
                  className="ml-auto text-[13px] font-medium text-brand hover:underline"
                >
                  Compare in {category?.name ?? group.category} →
                </Link>
              </div>

              <div className="mt-4 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Performance", group.performanceScore.toFixed(1)],
                  ["Value index", group.valueIndex?.toFixed(1) ?? "—"],
                  ["Independent hosts", String(group.hostCount)],
                  ["Raw runs", String(group.runCount)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-card px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <p className="mt-1 font-mono text-lg text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-xl border bg-card px-5 py-4">
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
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd
                        className="mt-0.5 truncate font-mono text-xs text-foreground"
                        title={value}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {group.results.map((result) => (
                  <TestCard key={result.test} result={result} peers={peers} />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>
                  P99{" "}
                  {group.hostCount >= P99_RECOMMENDED_HOSTS
                    ? "meets the 100-host evidence target"
                    : `is an estimate until ${P99_RECOMMENDED_HOSTS} independent hosts`}
                </span>
                {group.runs.map((run) => (
                  <a
                    key={run.slug}
                    href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${run.slug}.json`}
                    className="text-brand hover:underline"
                  >
                    {run.slug}.json
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
