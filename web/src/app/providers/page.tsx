import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { formatEuro } from "@/components/charts/scales";
import { CompanyLogo } from "@/components/company-logo";
import { aggregateRuns, bestRegionPerPlan, currentScoredGroups } from "@/lib/aggregate";
import { loadRuns } from "@/lib/data";
import { PROVIDERS } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Providers",
  description: "Every provider on the bench: measured plans, best composite score and entry price.",
};

export default function ProvidersPage() {
  const runs = loadRuns();
  const plans = bestRegionPerPlan(currentScoredGroups(aggregateRuns(runs)));
  const rows = PROVIDERS.map((provider) => {
    const own = plans.filter((plan) => plan.provider.name === provider.slug);
    const prices = own.flatMap((plan) => (plan.provider.price_eur_month ? [plan.provider.price_eur_month] : []));
    return {
      provider,
      plans: own.length,
      runs: runs.filter((run) => run.provider.name === provider.slug).length,
      best: own.length ? Math.max(...own.map((plan) => plan.performanceScore)) : undefined,
      from: prices.length ? Math.min(...prices) : undefined,
    };
  }).sort((a, b) => (b.best ?? -1) - (a.best ?? -1));

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
        {rows.map(({ provider, plans: planCount, runs: runCount, best, from }) => {
          const measured = runCount > 0;
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-3.5">
                <span aria-hidden className="h-6 w-0.5 shrink-0 rounded-full" style={{ background: provider.color }} />
                <CompanyLogo company={provider.company} size="md" decorative />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{provider.name}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{provider.blurb}</span>
                </span>
              </span>
              {measured ? (
                <dl className="grid grid-cols-3 gap-6 text-right sm:w-[340px]">
                  <div>
                    <dt className="text-[12px] text-subtle">Plans</dt>
                    <dd className="num">{planCount}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">Best score</dt>
                    <dd className="num">{best?.toFixed(1) ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">From</dt>
                    <dd className="num">{from !== undefined ? `${formatEuro(from)}/mo` : "—"}</dd>
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
