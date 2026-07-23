import type { Metadata } from "next";
import Link from "next/link";
import * as motion from "motion/react-client";

import { CompanyLogo } from "@/components/company-logo";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategory } from "@/lib/categories";
import { loadRuns } from "@/lib/data";
import { PROVIDERS } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Providers",
  description: "Every provider in the ProviderBench dataset, across all benchmark categories.",
};

export default function ProvidersPage() {
  const runs = loadRuns();

  return (
    <main>
      <PageHeader
        eyebrow="Providers"
        title="Every provider, every category"
        lede="One page per provider with every benchmark we have for it. Providers are added by pull request — no listing fees, no partnerships."
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((p, i) => {
            const providerRuns = runs.filter((r) => r.provider.name === p.slug);
            const categories = [...new Set(providerRuns.map((r) => r.category ?? "compute"))];
            return (
              <motion.div
                key={p.slug}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
              >
                {providerRuns.length === 0 ? (
                  <Card className="h-full gap-3 opacity-70">
                    <CardHeader className="gap-2">
                      <div className="flex items-center gap-2.5">
                        <span aria-hidden className="size-3 rounded-full" style={{ background: p.color }} />
                        <CardTitle className="text-base">{p.name}</CardTitle>
                      </div>
                      <p className="text-[13px] leading-relaxed text-muted-foreground">{p.blurb}</p>
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <p className="text-[12px] text-muted-foreground">
                        Awaiting first report —{" "}
                        <Link href="/cli" className="text-brand hover:underline">
                          run the benchmark
                        </Link>
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                <Link href={`/providers/${p.slug}`} className="group block h-full">
                  <Card className="h-full gap-3 transition-colors group-hover:border-input">
                    <CardHeader className="gap-2">
                      <div className="flex items-center gap-3">
                        <CompanyLogo company={p.company} size="md" decorative />
                        <div>
                          <CardTitle className="text-base">{p.name}</CardTitle>
                          <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full"
                              style={{ background: p.color }}
                            />
                            provider
                          </span>
                        </div>
                      </div>
                      <p className="text-[13px] leading-relaxed text-muted-foreground">{p.blurb}</p>
                    </CardHeader>
                    <CardContent className="mt-auto flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {categories.map((c) => (
                          <Badge key={c} variant="secondary" className="font-normal">
                            {getCategory(c)?.name ?? c}
                          </Badge>
                        ))}
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {providerRuns.length} {providerRuns.length === 1 ? "run" : "runs"}
                      </span>
                    </CardContent>
                  </Card>
                </Link>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
