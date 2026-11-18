import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CodeBlock } from "@/components/code-block";
import { CompanyBadge } from "@/components/company-logo";
import { CATEGORIES, getCategory } from "@/lib/categories";

// Live categories render as the dashboard on "/". This route serves the
// categories that are designed but not yet measuring.
export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.filter((c) => c.status !== "live").map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const category = getCategory((await params).category);
  return { title: category?.name, description: category?.description };
}

export default async function PlannedCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const category = getCategory((await params).category);
  if (!category || category.status === "live") notFound();

  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">
          {category.name} · {category.tagline} · planned
        </p>
        <h1 className="mt-1.5 text-[28px] leading-[34px] font-medium tracking-[-0.03em] sm:text-[32px] sm:leading-[38px]">
          {category.name} benchmarks
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
          {category.description}
        </p>
      </header>

      <section aria-labelledby="measure-title" className="grid gap-10 border-b border-border px-4 py-8 sm:px-7 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 id="measure-title" className="text-base font-medium tracking-tight">
            What we&rsquo;ll measure
          </h2>
          <ul className="flex flex-col text-[14px]">
            {category.metrics.map((metric) => (
              <li key={metric} className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
                {metric}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-medium tracking-tight">Providers on the roadmap</h2>
          <div className="flex flex-wrap gap-2">
            {category.plannedCompanies?.map((planned) => (
              <CompanyBadge key={planned.company} company={planned.company} label={planned.label} />
            ))}
          </div>
          <p className="text-[13px] leading-[20px] text-pretty text-muted-foreground">
            Same rules as compute: deterministic workloads, open data, no affiliations. Charts go live with the first
            complete measurement campaigns.
          </p>
        </div>
      </section>

      <section aria-labelledby="try-title" className="flex max-w-3xl flex-col gap-3 px-4 py-8 sm:px-7">
        <h2 id="try-title" className="text-base font-medium tracking-tight">
          Already in the CLI
        </h2>
        <p className="text-[13px] leading-[20px] text-muted-foreground">
          The suite works against any S3-compatible endpoint today. Credentials are read from the environment.
        </p>
        <CodeBlock title="object storage suite">{`providerbench run -t s3`}</CodeBlock>
        <p className="text-[13px] text-muted-foreground">
          Want this sooner?{" "}
          <a
            href="https://github.com/niklas-schmidt-dev/providerbench/issues"
            className="text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
          >
            Propose metrics or contribute a campaign
          </a>
          .
        </p>
      </section>
    </main>
  );
}
