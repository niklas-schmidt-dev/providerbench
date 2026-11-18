import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";
import { DsCard } from "@/components/ds/card";
import { SectionHead } from "@/components/ds/section-head";

export const metadata: Metadata = {
  title: "CLI",
  description:
    "Install and run the ProviderBench CLI, extend it with your own benchmarks, and submit results.",
};

export default function CliPage() {
  return (
    <main>
      <section className="hero-dark">
        <div className="mx-auto max-w-(--content-max) px-4 pt-9 pb-8 sm:px-8">
          <span className="pb-label inline-flex items-center gap-[7px] text-signal">
            <span aria-hidden className="led size-1.5 rounded-full bg-signal" />
            The instrument
          </span>
          <h1 className="mt-3 max-w-3xl text-[34px] leading-[40px] font-semibold tracking-[-0.025em] text-gray-0 sm:text-[40px] sm:leading-[44px]">
            One binary, ninety seconds, every number on this site
          </h1>
          <p className="mt-2.5 max-w-[560px] text-[15px] leading-[23px] text-gray-400">
            A static Go binary with no dependencies, no daemon and no account.
            Point it at a fresh VPS and get a shareable JSON report.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-(--content-max) gap-5 px-4 pt-8 pb-4 sm:px-8">
        <SectionHead eyebrow="01" title="Install" />
        <div className="grid gap-4">
          <CodeBlock title="with Go 1.26+">
            {`go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest`}
          </CodeBlock>
          <CodeBlock title="or build from source">
            {`git clone https://github.com/niklas-schmidt-dev/providerbench
cd providerbench && go build -o providerbench ./cmd/providerbench`}
          </CodeBlock>
        </div>

        <SectionHead className="mt-8" eyebrow="02" title="Run" />
        <div className="grid gap-4">
          <CodeBlock title="full run with a shareable report">
            {`providerbench run \\
  --provider hetzner --product cloud-vps --plan cax21 \\
  --region fsn1 --price 7.55 --env os_image=ubuntu-24.04 \\
  --json report.json`}
          </CodeBlock>
          <CodeBlock title="pick your tests, go faster">
            {`providerbench run --quick -t cpu,steal     # 20 seconds: compute + consistency signals
providerbench run -t disk --dir /mnt/data  # benchmark a specific volume
providerbench list                         # every available test
providerbench system                       # detected hardware & virtualization`}
          </CodeBlock>
        </div>
        <p className="max-w-2xl text-[13px] leading-[19px] text-muted-foreground">
          For honest numbers: use a <em>fresh</em> instance, run at least twice at
          different times of day, and run nothing else while measuring. The disk
          test writes a 1 GiB file in the working directory (or{" "}
          <code className="font-mono text-xs">--dir</code>) and removes it
          afterwards.
        </p>

        <SectionHead
          className="mt-8"
          eyebrow="03"
          title="Extend it"
          note="Every test implements one interface and registers itself. Adding a benchmark — PostgreSQL transactions, Redis ops, S3 upload speed, LLM time-to-first-token — is one file."
        />
        <CodeBlock title="internal/tests/mytest.go">
          {`package tests

import (
    "context"

    "github.com/niklas-schmidt-dev/providerbench/internal/bench"
)

func init() { bench.Register(myTest{}) }

type myTest struct{}

func (myTest) Name() string        { return "mytest" }
func (myTest) Description() string { return "what this measures, one line" }

func (myTest) Run(ctx context.Context, opts Options) (*bench.Result, error) {
    res := newResult("mytest")

    // ... measure something ...
    res.Add("my_metric", 42.0, "ops/s", true) // name, value, unit, higher-is-better

    finish(res)
    return res, ctx.Err()
}`}
        </CodeBlock>
        <p className="max-w-2xl text-[13px] leading-[19px] text-muted-foreground">
          That&rsquo;s the whole contract. The test now shows up in{" "}
          <code className="font-mono text-xs">providerbench list</code>, runs with
          everything else, and lands in the JSON report.
        </p>

        <SectionHead className="mt-8" eyebrow="04" title="Submit your results" />
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              [
                "Run",
                "Benchmark with --json report.json and the --provider / --plan / --region / --price flags filled in.",
              ],
              [
                "Add",
                "Rename the file provider-plan.json and drop it into data/results/ in the repository.",
              ],
              [
                "Open a PR",
                "Reports carry full system info, so anyone can sanity-check them — or rerun the same plan to verify.",
              ],
            ] as const
          ).map(([title, body], i) => (
            <DsCard key={title} padding="18px">
              <p className="pb-num text-[12px] font-medium text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="mt-2.5 text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </p>
              <p className="mt-1.5 text-[13px] leading-[19px] text-muted-foreground">
                {body}
              </p>
            </DsCard>
          ))}
        </div>
      </div>
    </main>
  );
}
