import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { CompanyLogo } from "@/components/company-logo";
import { aggregateRuns, bestRegionPerPlan, currentScoredGroups } from "@/lib/aggregate";
import { categoryMeta } from "@/lib/categories";
import { loadRuns } from "@/lib/data";
import { priceLabel } from "@/lib/plans";
import { getProvider, PROVIDERS } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Providers",
  description: "Every provider on the bench: what was measured, the best composite score and the entry price.",
};

export default function ProvidersPage() {
  const runs = loadRuns();
  const plans = bestRegionPerPlan(currentScoredGroups(aggregateRuns(runs)));
  // Registered providers, measured or not, and every other provider a report names.
  const measured = [...new Set(runs.flatMap((run) => (run.provider.name ? [run.provider.name] : [])))].sort();
  const slugs = [...new Set([...PROVIDERS.map((provider) => provider.slug), ...measured])];
  const rows = slugs
    .map((slug) => {
      const provider = getProvider(slug);
      const own = plans.filter((plan) => plan.provider.name === slug);
      const cheapest = own
        .filter((plan) => plan.provider.price_eur_month)
        .sort((a, b) => a.provider.price_eur_month! - b.provider.price_eur_month!)[0];
      const scores = own.flatMap((plan) => (plan.performanceScore === undefined ? [] : [plan.performanceScore]));
      const categories = [...new Set(own.map((plan) => categoryMeta(plan.category).name))];
      return {
        provider,
        blurb: provider.blurb || (categories.length ? `Measured in ${categories.join(", ")}.` : ""),
        // A plan measured in two categories is still one plan.
        plans: new Set(own.map((plan) => `${plan.provider.product}\n${plan.provider.plan}`)).size,
        runs: runs.filter((run) => run.provider.name === slug).length,
        best: scores.length ? Math.max(...scores) : undefined,
        benchmarks: categories.length,
        from: cheapest ? priceLabel({ priceMonth: cheapest.provider.price_eur_month, tier: cheapest.provider.tier }) : undefined,
      };
    })
    .sort((a, b) => (b.best ?? -1) - (a.best ?? -1) || Number(b.runs > 0) - Number(a.runs > 0));

  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">Providers</p>
        <h1 className="mt-1.5 text-[28px] leading-[34px] font-medium tracking-[-0.03em] sm:text-[32px] sm:leading-[38px]">
          Who is on the bench
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
          Providers enter with their first complete campaign: 10 fresh hosts per plan, 3 repeats each. Everyone else is
          on the list, waiting for data.
        </p>
      </header>

      <ul className="divide-y divide-border border-b border-border">
        {rows.map(({ provider, blurb, plans: planCount, runs: runCount, best, benchmarks, from }) => {
          const measured = runCount > 0;
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-3.5">
                <span aria-hidden className="h-6 w-0.5 shrink-0 rounded-full" style={{ background: provider.color }} />
                {provider.company && <CompanyLogo company={provider.company} size="md" decorative />}
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{provider.name}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{blurb}</span>
                </span>
              </span>
              {measured ? (
                <dl className="grid grid-cols-3 gap-6 text-right sm:w-[340px]">
                  <div>
                    <dt className="text-[12px] text-subtle">Plans</dt>
                    <dd className="num">{planCount}</dd>
                  </div>
                  {/* A score exists only where a category defines one. */}
                  <div>
                    <dt className="text-[12px] text-subtle">{best === undefined ? "Benchmarks" : "Best score"}</dt>
                    <dd className="num">{best === undefined ? benchmarks : best.toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">From</dt>
                    <dd className="num">{from ? `${from}/mo` : "—"}</dd>
                  </div>
                </dl>
              ) : (
                <span className="text-[13px] text-subtle sm:w-[340px] sm:text-right">Awaiting first campaign</span>
              )}
            </>
          );
          return (
            <li key={provider.slug}>
              {measured ? (
                <Link
                  href={`/providers/${provider.slug}`}
                  className="flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-hover sm:flex-row sm:items-center sm:justify-between sm:px-7"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="px-4 py-6 text-[13px] text-muted-foreground sm:px-7">
        Missing a provider?{" "}
        <a
          href="https://github.com/niklas-schmidt-dev/providerbench/blob/main/CONTRIBUTING.md"
          className="inline-flex items-center gap-0.5 text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
        >
          Run a campaign and submit it
          <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      </p>
    </main>
  );
}
