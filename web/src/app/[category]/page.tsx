import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GitPullRequest } from "lucide-react";

import { CategoryBar } from "@/components/category-bar";
import { ComparisonTable } from "@/components/comparison-table";
import { CompanyBadge } from "@/components/company-logo";
import { DsBadge } from "@/components/ds/badge";
import { DsCard } from "@/components/ds/card";
import { MetricStat } from "@/components/ds/metric-stat";
import { Freshness, SectionHead } from "@/components/ds/section-head";
import { MetricChart } from "@/components/metric-chart";
import { PricePerformanceChart } from "@/components/price-performance-chart";
import { SampleBanner } from "@/components/sample-banner";
import { ValueChart } from "@/components/value-chart";
import {
  aggregateRuns,
  bestRegionPerPlan,
  currentScoredGroups,
} from "@/lib/aggregate";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { anySample, runsByCategory } from "@/lib/data";
import { providerLabel } from "@/lib/providers";
import { resolveScatterMetrics, resolveTableColumns } from "@/lib/report";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const category = getCategory((await params).category);
  return {
    title: category?.name,
    description: category?.description,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const category = getCategory((await params).category);
  if (!category) notFound();

  return category.status === "live" ? (
    <LiveCategory categorySlug={category.slug} />
  ) : (
    <PlannedCategory slug={category.slug} />
  );
}

function LiveCategory({ categorySlug }: { categorySlug: string }) {
  const category = getCategory(categorySlug)!;
  const report = category.report!;
  const runs = runsByCategory(categorySlug);
  const groups = bestRegionPerPlan(currentScoredGroups(aggregateRuns(runs)));
  const sample = anySample(runs);
  const columns = resolveTableColumns(report.tableMetrics);
  const scatterMetrics = resolveScatterMetrics(report.scatterMetrics);

  const ranked = groups
    .filter((g) => g.rankEligible)
    .sort((a, b) => b.performanceScore - a.performanceScore);
  const leader = ranked[0] ?? groups[0];
  const medianScore =
    ranked.length > 0
      ? ranked[Math.floor((ranked.length - 1) / 2)].performanceScore
      : 0;
  const cheapest = [...groups]
    .filter((g) => g.provider.price_eur_month)
    .sort((a, b) => a.provider.price_eur_month! - b.provider.price_eur_month!)[0];
  const providerCount = new Set(groups.map((g) => g.provider.name)).size;
  const updated = runs.map((r) => r.created_at).sort().at(-1);
  const updatedLabel = updated
    ? new Date(updated).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

  return (
    <main>
      <section className="hero-dark">
        <div className="mx-auto flex max-w-(--content-max) flex-wrap items-end gap-x-10 gap-y-8 px-4 pt-9 pb-8 sm:px-8">
          <div className="min-w-[300px] flex-1">
            <span className="pb-label inline-flex items-center gap-[7px] text-signal">
              <span aria-hidden className="led size-1.5 rounded-full bg-signal" />
              Live leaderboard
            </span>
            <h1 className="mt-3 text-[34px] leading-[40px] font-semibold tracking-[-0.025em] text-gray-0 sm:text-[40px] sm:leading-[44px]">
              {category.name} benchmarks
            </h1>
            <p className="mt-2.5 max-w-[560px] text-[15px] leading-[23px] text-gray-400">
              {category.description} {providerCount} providers, measured with the
              same open harness on fresh hosts. Every sample is published.
            </p>
          </div>
          <div className="grid min-w-[300px] flex-1 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-7">
            {leader?.provider.name && (
              <MetricStat
                inverse
                label="Leader"
                value={leader.performanceScore.toFixed(1)}
                note={providerLabel(leader.provider.name)}
              />
            )}
            <MetricStat inverse label="Field median" value={medianScore.toFixed(1)} note="composite index" />
            {cheapest?.provider.name && (
              <MetricStat
                inverse
                label="Cheapest"
                value={`€${cheapest.provider.price_eur_month!.toFixed(2)}`}
                note={`${providerLabel(cheapest.provider.name)} / mo`}
              />
            )}
          </div>
        </div>
      </section>

      <CategoryBar
        active={categorySlug}
        right={
          <div className="py-[7px]">
            <Freshness>Dataset updated {updatedLabel}</Freshness>
          </div>
        }
      />

      <div className="mx-auto grid max-w-(--content-max) gap-6 px-4 pt-8 pb-4 sm:px-8">
        {sample && <SampleBanner />}

        <SectionHead
          eyebrow="Work per euro"
          title="What €100 actually buys"
          note="Measured composite work per euro of list price, normalized to the best-value plan. Raw price and raw performance are on the board — this is the combination."
        />
        <ValueChart groups={groups} />
        <PricePerformanceChart groups={groups} metrics={scatterMetrics} />

        {report.sections.map((section) => (
          <section key={section.title} className="grid gap-5">
            <SectionHead
              className="mt-8"
              eyebrow={category.name}
              title={section.title}
              note={section.description}
            />
            <div className="grid gap-5 lg:grid-cols-2">
              {section.charts.map((ref) => (
                <MetricChart
                  key={`${ref.test}.${ref.metric}`}
                  groups={groups}
                  test={ref.test}
                  metric={ref.metric}
                />
              ))}
            </div>
          </section>
        ))}

        <SectionHead
          className="mt-8"
          eyebrow="Measurement by measurement"
          title="Full comparison"
          note="Every headline metric side by side — the best cell in each column is set in ink. Click a provider for its full report."
        />
        <ComparisonTable groups={groups} columns={columns} />
        <p className="font-mono text-[11.5px] text-muted-foreground">
          Raw reports:{" "}
          <a
            href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results"
            className="border-b border-(--border-strong) text-foreground hover:border-foreground"
          >
            data/results/
          </a>{" "}
          · every chart links its benchmark source
        </p>
      </div>
    </main>
  );
}

function PlannedCategory({ slug }: { slug: string }) {
  const category = getCategory(slug)!;
  const Icon = category.icon;

  return (
    <main>
      <section className="hero-dark">
        <div className="mx-auto max-w-(--content-max) px-4 pt-9 pb-8 sm:px-8">
          <span className="pb-label inline-flex items-center gap-[7px] text-gray-500">
            <span aria-hidden className="size-1.5 rounded-full bg-(--warn-500)" />
            Planned — not yet measuring
          </span>
          <h1 className="mt-3 text-[34px] leading-[40px] font-semibold tracking-[-0.025em] text-gray-0 sm:text-[40px] sm:leading-[44px]">
            {category.name} benchmarks
          </h1>
          <p className="mt-2.5 max-w-[560px] text-[15px] leading-[23px] text-gray-400">
            {category.description}
          </p>
        </div>
      </section>

      <CategoryBar active={slug} />

      <div className="mx-auto grid max-w-(--content-max) gap-6 px-4 pt-8 pb-4 sm:px-8">
        <div className="grid gap-5 lg:grid-cols-2">
          <DsCard
            title={
              <span className="flex items-center gap-2">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                What we&rsquo;ll measure
              </span>
            }
          >
            <ul className="grid gap-3 pt-1">
              {category.metrics.map((m) => (
                <li
                  key={m}
                  className="flex items-center gap-3 text-[13.5px] text-(--text-body)"
                >
                  <span aria-hidden className="size-1.5 shrink-0 rounded-[2px] bg-gray-950" />
                  {m}
                </li>
              ))}
            </ul>
          </DsCard>
          <DsCard title="Providers on the roadmap">
            <div className="flex flex-wrap gap-2 pt-1">
              {category.plannedCompanies?.map((planned) => (
                <CompanyBadge
                  key={planned.company}
                  company={planned.company}
                  label={planned.label}
                />
              ))}
            </div>
            <p className="mt-5 text-[13px] leading-[19px] text-muted-foreground">
              Same rules as compute: deterministic workloads, open data, no
              affiliations. The suite already ships in the CLI —{" "}
              <code className="font-mono text-xs">
                providerbench run -t s3
              </code>{" "}
              works against any S3-compatible endpoint today. Dashboards go
              live with the first complete measurement campaigns.
            </p>
          </DsCard>
        </div>

        <DsCard padding="24px">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <GitPullRequest aria-hidden className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  Want this category sooner?
                </p>
                <p className="mt-1 text-[13px] leading-[19px] text-muted-foreground">
                  The benchmark framework is one Go interface — category suites
                  are designed in the open. Propose metrics or contribute tests.
                </p>
              </div>
            </div>
            <span className="flex items-center gap-2">
              <DsBadge tone="neutral">Open design</DsBadge>
              <a
                href="https://github.com/niklas-schmidt-dev/providerbench/issues"
                className="inline-flex h-[30px] items-center rounded-(--radius-sm) border border-(--border-strong) bg-card px-3 text-[13px] font-medium text-foreground shadow-(--shadow-xs) transition-colors hover:bg-(--surface-hover)"
              >
                Open a discussion
              </a>
            </span>
          </div>
        </DsCard>
      </div>
    </main>
  );
}
