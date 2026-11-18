import Link from "next/link";

import { SCORE_WEIGHTS_BY_SUITE } from "@/lib/scoring";

const RULES: Array<[string, string]> = [
  ["Account", "Pay-as-you-go, no negotiated pricing, no vendor contact. Net EUR, excl. VAT."],
  ["Hosts", "Fresh instances only. A plan ranks once its complete 10-host cohort lands."],
  ["Repeats", "3 repeats per host, reduced to one host median before cross-host statistics."],
  ["Statistic", "The headline is the cross-host P50, never a cherry-picked machine."],
  ["Tails", "P10, P90 and P99 publish beside every median. Variance is the product."],
  ["Exclusions", "Failed suites invalidate the composite. Errors are reported, never imputed."],
];

/** How the numbers are made: the measurement rules and the composite's weights. */
export function MethodSection({ id }: { id: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-b border-border px-4 py-8 sm:px-7">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-base font-medium tracking-tight">
          How the numbers are made
        </h2>
        <p className="max-w-[68ch] text-[13px] text-pretty text-muted-foreground">
          One static Go binary runs deterministic, open workloads on fresh hosts. Every number on this page exists as a
          dated raw report anyone can rerun or dispute.
        </p>
      </div>
      <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-[1.4fr_1fr]">
        <dl className="grid content-start gap-y-0 text-[13px]">
          {RULES.map(([term, text]) => (
            <div key={term} className="grid grid-cols-[96px_1fr] gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0">
              <dt className="text-subtle">{term}</dt>
              <dd className="text-pretty">{text}</dd>
            </div>
          ))}
        </dl>
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
            <Link href="/cli" className="text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground">
              Run the benchmark yourself
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
