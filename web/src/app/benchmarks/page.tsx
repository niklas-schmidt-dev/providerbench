import type { Metadata } from "next";
import Link from "next/link";

import { formatMeasurementDate } from "@/lib/dates";
import { siteCategories } from "@/lib/site";

export const metadata: Metadata = {
  title: "All benchmarks",
  description: "Every benchmark category on ProviderBench: the ones with published reports and the ones the CLI can already measure.",
};

export default function BenchmarksPage() {
  const categories = siteCategories();
  // Published first; inside each half the registry order holds.
  const ordered = [...categories.filter((c) => c.live), ...categories.filter((c) => !c.live)];

  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">Benchmarks</p>
        <h1 className="mt-1.5 text-[28px] leading-[34px] font-medium tracking-[-0.03em] sm:text-[32px] sm:leading-[38px]">
          Everything on the bench
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
          A category appears here as soon as the CLI can measure it, and becomes a dashboard with its first published
          report. Each dashboard is laid out from the reports themselves, whatever they measure.
        </p>
      </header>

      <ul className="divide-y divide-border border-b border-border">
        {ordered.map((category) => (
          <li key={category.slug}>
            <Link
              href={category.href}
              className="flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-hover sm:flex-row sm:items-center sm:justify-between sm:px-7"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="font-medium">{category.name}</span>
                  {category.tagline && <span className="text-[13px] text-subtle">{category.tagline}</span>}
                </span>
                <span className="max-w-[78ch] text-[13px] text-pretty text-muted-foreground">{category.description}</span>
                {category.tests.length > 0 && (
                  <span className="mt-0.5 font-mono text-[12px] text-subtle">
                    {category.tests.map((test) => test.name).join(" · ")}
                  </span>
                )}
              </span>
              {category.live ? (
                <dl className="grid shrink-0 grid-cols-3 gap-6 text-right sm:w-[340px]">
                  <div>
                    <dt className="text-[12px] text-subtle">Providers</dt>
                    <dd className="num">{category.providers}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">Raw runs</dt>
                    <dd className="num">{category.reports}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-subtle">Updated</dt>
                    <dd className="num whitespace-nowrap">
                      {category.updated ? formatMeasurementDate(category.updated).replace(" UTC", "") : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <span className="shrink-0 text-[13px] text-subtle sm:w-[340px] sm:text-right">
                  {category.tests.length > 0 ? "In the CLI · no published reports yet" : "Planned"}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="px-4 py-6 text-[13px] text-muted-foreground sm:px-7">
        Measuring something else? A report with a new category gets its page without a change to the site.{" "}
        <Link href="/cli" className="text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground">
          See how to add a test
        </Link>
      </p>
    </main>
  );
}
