import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { PageHeader } from "@/components/page-header";
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
import { getCategory } from "@/lib/categories";
import {
  allSample,
  loadRuns,
  runsForProvider,
  type Run,
  type TestResult,
} from "@/lib/data";
import { formatMetricValue } from "@/lib/format";
import { getProvider, PROVIDERS } from "@/lib/providers";

export const dynamicParams = false;

export function generateStaticParams() {
  // Only providers with at least one published run get a page.
  const withRuns = new Set(loadRuns().map((r) => r.provider.name));
  return PROVIDERS.filter((p) => withRuns.has(p.slug)).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const provider = getProvider((await params).slug);
  return {
    title: provider.name,
    description: `All ProviderBench results for ${provider.name}.`,
  };
}

/** Best value among peer runs for a metric, for the "vs best" column. */
function bestOf(peers: Run[], test: string, metric: string, higherIsBetter: boolean) {
  const values = peers.flatMap(
    (r) =>
      r.results
        .find((x) => x.test === test)
        ?.metrics.filter((m) => m.name === metric)
        .map((m) => m.value) ?? [],
  );
  if (values.length === 0) return undefined;
  return higherIsBetter ? Math.max(...values) : Math.min(...values);
}

function TestCard({ result, peers }: { result: TestResult; peers: Run[] }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="font-mono text-sm">{result.test}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8">Metric</TableHead>
              <TableHead className="h-8 text-right">Value</TableHead>
              <TableHead className="h-8 text-right">vs best</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.metrics.map((m) => {
              const best = bestOf(peers, result.test, m.name, m.higher_is_better);
              const isBest = best !== undefined && m.value === best;
              // How far this value trails the best in category, in %.
              const gap =
                best === undefined || best === 0 || isBest
                  ? 0
                  : m.higher_is_better
                    ? (1 - m.value / best) * 100
                    : (m.value / best - 1) * 100;
              return (
                <TableRow key={m.name}>
                  <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                    {m.name}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs tabular-nums text-foreground">
                    {formatMetricValue(m.value)}{" "}
                    <span className="text-muted-foreground">{m.unit}</span>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    {isBest ? (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] text-success">
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
        {result.notes && result.notes.length > 0 && (
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
  const runs = runsForProvider(slug);
  if (runs.length === 0) notFound();
  const all = loadRuns();

  return (
    <main>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {provider.company && (
              <CompanyLogo company={provider.company} size="xs" decorative />
            )}
            <span aria-hidden className="size-2 rounded-full" style={{ background: provider.color }} />
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
              {provider.website.replace("https://", "")} <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </div>
      </PageHeader>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {allSample(runs) && (
          <div className="mt-8">
            <SampleBanner />
          </div>
        )}

        {runs.map((run) => {
          const categorySlug = run.category ?? "compute";
          const category = getCategory(categorySlug);
          const peers = all.filter((r) => (r.category ?? "compute") === categorySlug);
          return (
            <section key={run.slug} className="mt-12">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  {category?.name ?? categorySlug}
                </h2>
                <Badge variant="secondary" className="font-mono font-normal">
                  {run.provider.plan}
                </Badge>
                <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
                  {run.provider.region}
                </Badge>
                {run.provider.price_eur_month ? (
                  <Badge variant="outline" className="font-mono font-normal text-muted-foreground">
                    €{run.provider.price_eur_month.toFixed(2)}/mo
                  </Badge>
                ) : null}
                <Link
                  href={`/${categorySlug}`}
                  className="ml-auto text-[13px] font-medium text-brand hover:underline"
                >
                  Compare in {category?.name ?? categorySlug} →
                </Link>
              </div>

              <div className="mt-4 rounded-xl border bg-card px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["CPU", run.system.cpu_model ?? "—"],
                    ["Cores", String(run.system.cpu_cores)],
                    ["Memory", run.system.mem_total_mb ? `${(run.system.mem_total_mb / 1024).toFixed(0)} GiB` : "—"],
                    ["OS / arch", `${run.system.os}/${run.system.arch}`],
                    ["Virtualization", run.system.virtualization ?? "—"],
                    ["CLI", run.cli_version],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] text-muted-foreground">{label}</dt>
                      <dd className="mt-0.5 truncate font-mono text-xs text-foreground" title={value}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {run.results.map((result) => (
                  <TestCard key={result.test} result={result} peers={peers} />
                ))}
              </div>

              <p className="mt-3 font-mono text-xs text-muted-foreground">
                Raw report:{" "}
                <a
                  href={`https://github.com/niklas-schmidt-dev/providerbench/blob/main/data/results/${run.slug}.json`}
                  className="text-brand hover:underline"
                >
                  data/results/{run.slug}.json
                </a>
              </p>
            </section>
          );
        })}
      </div>
    </main>
  );
}
