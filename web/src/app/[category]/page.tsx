import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CodeBlock } from "@/components/code-block";
import { CompanyBadge } from "@/components/company-logo";
import { Dashboard } from "@/components/dashboard/dashboard";
import { categoryMeta, HOME_CATEGORY } from "@/lib/categories";
import { loadDashboard } from "@/lib/dashboard-data";
import { protocolUrl } from "@/lib/plans";
import { siteCategories, siteCategory, type SiteCategory } from "@/lib/site";

// One page per category the data, the CLI or the registry knows. A category
// with a published report renders as a dashboard laid out from its reports;
// the others say what the suite measures and how to run it. The home
// category lives on "/".
export const dynamicParams = false;

export function generateStaticParams() {
  return siteCategories()
    .filter((category) => category.slug !== HOME_CATEGORY)
    .map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const category = siteCategory((await params).category);
  return { title: category?.name, description: category?.description };
}

const LINK = "text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground";

function AwaitingCategory({ category }: { category: SiteCategory }) {
  const roadmap = categoryMeta(category.slug).roadmap;
  const inCli = category.tests.length > 0;
  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">
          {[category.name, category.tagline, "no published reports yet"].filter(Boolean).join(" · ")}
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
            {inCli ? "What the suite measures" : "What we’ll measure"}
          </h2>
          {inCli ? (
            <ul className="flex flex-col text-[14px]">
              {category.tests.map((test) => (
                <li key={test.name} className="flex flex-col gap-0.5 border-t border-border py-2.5 first:border-t-0 first:pt-0">
                  <span className="font-mono text-[12px]">
                    {test.name}
                    {test.profile !== "standard" && <span className="ml-2 text-subtle">{test.profile} profile</span>}
                  </span>
                  <span className="text-[13px] text-pretty text-muted-foreground">{test.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col text-[14px]">
              {(roadmap?.metrics ?? []).map((metric) => (
                <li key={metric} className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
                  {metric}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {roadmap?.companies?.length ? (
            <>
              <h2 className="text-base font-medium tracking-tight">Providers on the roadmap</h2>
              <div className="flex flex-wrap gap-2">
                {roadmap.companies.map((planned) => (
                  <CompanyBadge key={planned.company} company={planned.company} label={planned.label} />
                ))}
              </div>
            </>
          ) : (
            <h2 className="text-base font-medium tracking-tight">When it goes live</h2>
          )}
          <p className="text-[13px] leading-[20px] text-pretty text-muted-foreground">
            The page turns into a dashboard with the first published report. Charts, the board and the search entries
            are laid out from the reports themselves, so nothing on the site has to change. Same rules as everywhere:
            open workloads, open data, no affiliations.
          </p>
          {category.protocol && (
            <p className="text-[13px] text-muted-foreground">
              Method:{" "}
              <a href={protocolUrl(category.protocol)} className={LINK}>
                {category.protocol}
              </a>
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="try-title" className="flex max-w-3xl flex-col gap-3 px-4 py-8 sm:px-7">
        <h2 id="try-title" className="text-base font-medium tracking-tight">
          {inCli ? "Already in the CLI" : "Not in the CLI yet"}
        </h2>
        {inCli ? (
          <>
            <p className="text-[13px] leading-[20px] text-muted-foreground">
              The suite runs today and writes a report you can validate and submit. Some suites read their target from
              the environment; <code className="font-mono text-[12px] text-foreground">providerbench --help</code> lists
              what each one needs.
            </p>
            <CodeBlock title={`${category.name.toLowerCase()} suite`}>{`providerbench run --category ${category.slug}`}</CodeBlock>
          </>
        ) : (
          <p className="text-[13px] leading-[20px] text-muted-foreground">
            This category is planned. <Link href="/cli" className={LINK}>The CLI page</Link> shows how a new test is
            added.
          </p>
        )}
        <p className="text-[13px] text-muted-foreground">
          Want this sooner?{" "}
          <a href="https://github.com/niklas-schmidt-dev/providerbench/issues" className={LINK}>
            Propose metrics or contribute a campaign
          </a>
          .
        </p>
      </section>
    </main>
  );
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const category = siteCategory((await params).category);
  if (!category || category.slug === HOME_CATEGORY) notFound();
  if (category.live) return <Dashboard data={loadDashboard(category.slug)} />;
  return <AwaitingCategory category={category} />;
}
