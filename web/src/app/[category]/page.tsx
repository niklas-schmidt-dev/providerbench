import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GitPullRequest } from "lucide-react";

import { ComparisonTable } from "@/components/comparison-table";
import { CompanyBadge } from "@/components/company-logo";
import { MetricChart } from "@/components/metric-chart";
import { PageHeader } from "@/components/page-header";
import { SampleBanner } from "@/components/sample-banner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { anySample, metricOf, runsByCategory, type Run } from "@/lib/data";

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
    <LiveCategory categorySlug={category.slug} name={category.name} description={category.description} />
  ) : (
    <PlannedCategory slug={category.slug} />
  );
}

function LiveCategory({
  categorySlug,
  name,
  description,
}: {
  categorySlug: string;
  name: string;
  description: string;
}) {
  const runs = runsByCategory(categorySlug);
  const sample = anySample(runs);

  return (
    <main>
      <PageHeader
        eyebrow={`Benchmarks / ${name}`}
        title={`${name} benchmarks`}
        lede={description}
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {sample && (
          <div className="mt-8">
            <SampleBanner />
          </div>
        )}

        <h2 className="mt-12 text-lg font-semibold text-foreground">
          Raw performance
        </h2>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Identical deterministic workloads on every machine — differences are
          the hardware, never the benchmark.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart runs={runs} test="cpu" metric="single_core_hash" />
          <MetricChart runs={runs} test="cpu" metric="multi_core_hash" />
          <MetricChart runs={runs} test="memory" metric="copy_bandwidth" />
          <MetricChart runs={runs} test="memory" metric="random_access_latency" />
          <MetricChart runs={runs} test="disk" metric="rand_read_4k" />
          <MetricChart runs={runs} test="network" metric="download" />
        </div>

        <h2 className="mt-16 text-lg font-semibold text-foreground">
          The overselling report
        </h2>
        <p className="mt-1 mb-6 max-w-2xl text-sm text-muted-foreground">
          On honest hardware, identical work takes identical time. These metrics
          catch the difference between the cores you rent and the cores you get.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart runs={runs} test="steal" metric="consistency_cv" />
          <MetricChart runs={runs} test="steal" metric="cpu_steal" />
          <MetricChart runs={runs} test="steal" metric="p99_over_p50" />
          <MetricChart runs={runs} test="disk" metric="fsync_latency_p50" />
        </div>

        <h2 className="mt-16 text-lg font-semibold text-foreground">
          Full comparison
        </h2>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Every headline metric side by side — click a provider for its full report.
        </p>
        <ComparisonTable runs={runs} />
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          Raw reports:{" "}
          <a
            href="https://github.com/niklas-schmidt-dev/providerbench/tree/main/data/results"
            className="text-brand hover:underline"
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
      <PageHeader
        eyebrow={`Benchmarks / ${category.name}`}
        title={`${category.name} benchmarks`}
        lede={category.description}
      >
        <Badge variant="outline" className="mt-5 text-muted-foreground">
          Planned — not yet measuring
        </Badge>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon aria-hidden className="size-4 text-brand" />
                What we'll measure
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {category.metrics.map((m) => (
                  <li key={m} className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span aria-hidden className="size-1 rounded-full bg-brand" />
                    {m}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Providers on the roadmap</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {category.plannedCompanies?.map((planned) => (
                  <CompanyBadge
                    key={planned.company}
                    company={planned.company}
                    label={planned.label}
                  />
                ))}
              </div>
              <p className="mt-5 text-[13px] leading-relaxed text-muted-foreground">
                Same rules as compute: deterministic workloads, open data, no
                affiliations. The test suite will ship in the same CLI —{" "}
                <code className="font-mono text-xs">providerbench run -t {slug === "ai" ? "ttft" : "s3"}</code>{" "}
                — so anyone can verify from their own network.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 rounded-xl border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <GitPullRequest aria-hidden className="mt-0.5 size-4 text-brand" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Want this category sooner?
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  The benchmark framework is one Go interface — category suites
                  are designed in the open. Propose metrics or contribute tests.
                </p>
              </div>
            </div>
            <a
              href="https://github.com/niklas-schmidt-dev/providerbench/issues"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open a discussion
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
