import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import type { MethodInfo } from "@/lib/dashboard-data";
import { PROTOCOLS_URL, RAW_DATA_URL } from "@/lib/plans";
import { SCORE_WEIGHTS_BY_SUITE } from "@/lib/scoring";

const LINK = "text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground";

// The rules a compute cohort has to meet before it ranks.
const RANKING_RULES: Array<[string, string]> = [
  ["Account", "Pay-as-you-go, no negotiated pricing, no vendor contact. Net EUR, excl. VAT."],
  ["Hosts", "Fresh instances only. A plan ranks once its complete 10-host cohort lands."],
  ["Repeats", "3 repeats per host, reduced to one host median before cross-host statistics."],
  ["Statistic", "The headline is the cross-host P50, never a cherry-picked machine."],
  ["Tails", "P10, P90 and P99 publish beside every median. Variance is the product."],
  ["Exclusions", "Failed suites invalidate the composite. Errors are reported, never imputed."],
];

function Rules({ children }: { children: React.ReactNode }) {
  return <dl className="grid content-start gap-y-0 text-[13px]">{children}</dl>;
}

function Rule({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0">
      <dt className="text-subtle">{term}</dt>
      <dd className="text-pretty">{children}</dd>
    </div>
  );
}

/** A ranked category: the measurement rules and the composite's weights. */
function RankedMethod() {
  return (
    <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-[1.4fr_1fr]">
      <Rules>
        {RANKING_RULES.map(([term, text]) => (
          <Rule key={term} term={term}>
            {text}
          </Rule>
        ))}
      </Rules>
      <div className="flex flex-col gap-3">
        <h3 className="text-[13px] font-medium">Composite score weights</h3>
        <ul className="flex flex-col gap-2.5">
          {SCORE_WEIGHTS_BY_SUITE.map(({ suite, label, weight }) => (
            <li key={suite} className="grid grid-cols-[1fr_40px] items-center gap-x-3 gap-y-1 text-[13px]">
              <span>{label}</span>
              <span className="num text-right text-muted-foreground">{weight}%</span>
              <span aria-hidden className="col-span-full h-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full bg-foreground" style={{ width: `${weight}%` }} />
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] leading-[18px] text-subtle">
          A weighted geometric mean of every metric&rsquo;s cross-host P50, normalized to the best plan (100).{" "}
          <Link href="/cli" className={LINK}>
            Run the benchmark yourself
          </Link>
        </p>
      </div>
    </div>
  );
}

/** A category without a ranking: what the numbers are, and what was measured. */
function OpenMethod({ method }: { method: MethodInfo }) {
  return (
    <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-[1.4fr_1fr]">
      <Rules>
        <Rule term="Protocol">
          <span className="font-mono text-[12px]">{method.protocols.join(", ")}</span>. Results compare only inside
          one protocol.{" "}
          <a href={method.protocolDoc?.href ?? PROTOCOLS_URL} className={LINK}>
            {method.protocolDoc ? `Read ${method.protocolDoc.protocol}` : "Protocol documents"}
          </a>
        </Rule>
        <Rule term="Statistic">
          A cohort of several hosts shows its cross-host P50 with the P10 to P90 spread. A single report shows the
          value it measured.
        </Rule>
        <Rule term="Ranking">
          No composite score is defined for this category, so nothing is ranked. Every column of the board sorts.
        </Rule>
        <Rule term="Raw data">
          Every number is a dated raw report anyone can rerun or dispute.{" "}
          <a href={RAW_DATA_URL} className={LINK}>
            Open the dataset
          </a>
        </Rule>
      </Rules>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium">What is measured</h3>
          <ul className="flex flex-col text-[13px]">
            {method.tests.map((test) => (
              <li key={test.name} className="border-t border-border py-2 first:border-t-0 first:pt-0">
                <a href={test.sourceUrl} className="font-mono text-[12px] underline decoration-border-strong underline-offset-3 hover:decoration-foreground">
                  {test.name}
                </a>
                {test.description && <span className="ml-2 text-muted-foreground">{test.description}</span>}
              </li>
            ))}
          </ul>
        </div>
        {method.command && <CodeBlock title="run it yourself">{method.command}</CodeBlock>}
      </div>
    </div>
  );
}

/** How the numbers are made. */
export function MethodSection({ id, method, scored }: { id: string; method: MethodInfo; scored: boolean }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-b border-border px-4 py-8 sm:px-7">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-base font-medium tracking-tight">
          How the numbers are made
        </h2>
        <p className="max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
          {scored
            ? "One static Go binary runs deterministic, open workloads on fresh hosts. Every number on this page exists as a dated raw report anyone can rerun or dispute."
            : "The page is laid out from the reports themselves: every test and metric they hold is shown, with the unit and direction each report states."}
        </p>
      </div>
      {scored ? <RankedMethod /> : <OpenMethod method={method} />}
    </section>
  );
}
