import type { Metadata } from "next";
import Link from "next/link";

import { CompanyLogo } from "@/components/company-logo";
import { DsBadge } from "@/components/ds/badge";
import { getCategory } from "@/lib/categories";
import { loadRuns } from "@/lib/data";
import { PROVIDERS } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Providers",
  description:
    "Every provider in the ProviderBench dataset, across all benchmark categories.",
};

export default function ProvidersPage() {
  const runs = loadRuns();

  return (
    <main>
      <section className="hero-dark">
        <div className="mx-auto max-w-(--content-max) px-4 pt-9 pb-8 sm:px-8">
          <span className="pb-label inline-flex items-center gap-[7px] text-signal">
            <span aria-hidden className="led size-1.5 rounded-full bg-signal" />
            Providers
          </span>
          <h1 className="mt-3 text-[34px] leading-[40px] font-semibold tracking-[-0.025em] text-gray-0 sm:text-[40px] sm:leading-[44px]">
            Every provider, every category
          </h1>
          <p className="mt-2.5 max-w-[560px] text-[15px] leading-[23px] text-gray-400">
            One page per provider with every benchmark we have for it. Providers
            are added by pull request — no listing fees, no partnerships.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-(--content-max) px-4 sm:px-8">
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p) => {
            const providerRuns = runs.filter((r) => r.provider.name === p.slug);
            const categories = [
              ...new Set(providerRuns.map((r) => r.category ?? "compute")),
            ];
            const identity = (
              <div className="flex items-center gap-3">
                <CompanyLogo company={p.company} size="sm" decorative />
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: p.color }}
                    />
                    {p.name}
                  </p>
                  <span className="pb-label mt-0.5 block text-[10px] text-muted-foreground">
                    {providerRuns.length === 0 ? "awaiting data" : "on the bench"}
                  </span>
                </div>
              </div>
            );
            const body = (
              <>
                {identity}
                <p className="text-[13px] leading-[19px] text-muted-foreground">
                  {p.blurb}
                </p>
                <div className="mt-auto flex items-center justify-between pt-1">
                  <div className="flex gap-1.5">
                    {providerRuns.length === 0 ? (
                      <DsBadge tone="outline">Awaiting first report</DsBadge>
                    ) : (
                      categories.map((c) => (
                        <DsBadge key={c} tone="neutral">
                          {getCategory(c)?.name ?? c}
                        </DsBadge>
                      ))
                    )}
                  </div>
                  <span className="pb-num text-[12px] text-muted-foreground">
                    {providerRuns.length} {providerRuns.length === 1 ? "run" : "runs"}
                  </span>
                </div>
              </>
            );

            return providerRuns.length === 0 ? (
              <div
                key={p.slug}
                className="flex h-full flex-col gap-3 rounded-md border border-(--border-hairline) bg-card px-5 py-5 opacity-70 shadow-(--shadow-xs)"
              >
                {body}
              </div>
            ) : (
              <Link key={p.slug} href={`/providers/${p.slug}`} className="group block h-full">
                <div className="flex h-full flex-col gap-3 rounded-md border border-(--border-hairline) bg-card px-5 py-5 shadow-(--shadow-xs) transition-colors group-hover:border-(--border-strong)">
                  {body}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
