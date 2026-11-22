import type { Metadata } from "next";

import { CodeBlock } from "@/components/code-block";

export const metadata: Metadata = {
  title: "CLI",
  description: "Install and run the ProviderBench CLI, extend it with your own benchmarks, and submit results.",
};

function Step({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${index}`} className="grid gap-4 border-b border-border px-4 py-8 sm:px-7 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
      <div className="flex items-baseline gap-3 lg:flex-col lg:gap-1">
        <span className="num text-[12px] text-subtle">{index}</span>
        <h2 id={`step-${index}`} className="text-base font-medium tracking-tight">
          {title}
        </h2>
      </div>
      <div className="flex min-w-0 max-w-3xl flex-col gap-4">{children}</div>
    </section>
  );
}

export default function CliPage() {
  return (
    <main id="main">
      <header className="border-b border-border px-4 pt-8 pb-7 sm:px-7">
        <p className="text-[12px] text-subtle">The instrument</p>
        <h1 className="mt-1.5 max-w-[24ch] text-[28px] leading-[34px] font-medium tracking-[-0.03em] text-balance sm:text-[32px] sm:leading-[38px]">
          One binary, ninety seconds, every number on this site
        </h1>
        <p className="mt-2 max-w-[62ch] text-[14px] leading-[22px] text-pretty text-muted-foreground">
          A static Go binary with no dependencies, no daemon and no account. Point it at a fresh VPS and get a
          shareable JSON report.
        </p>
      </header>

      <Step index="01" title="Install">
        <CodeBlock title="with Go 1.27+">
          {`go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest`}
        </CodeBlock>
        <CodeBlock title="or build from source">
          {`git clone https://github.com/niklas-schmidt-dev/providerbench
cd providerbench && go build -o providerbench ./cmd/providerbench`}
        </CodeBlock>
      </Step>

      <Step index="02" title="Run">
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
        <p className="text-[13px] leading-[20px] text-pretty text-muted-foreground">
          For honest numbers use a fresh instance, run at different times of day, and run nothing else while
          measuring. The disk test writes a 1 GiB file in the working directory (or{" "}
          <code className="font-mono text-[12px] text-foreground">--dir</code>) and removes it afterwards.
        </p>
      </Step>

      <Step index="03" title="Extend it">
        <p className="text-[13px] leading-[20px] text-pretty text-muted-foreground">
          Every test implements one interface and registers itself. Adding a benchmark (PostgreSQL transactions, Redis
          ops, S3 upload speed) is one file.
        </p>
        <CodeBlock title="internal/tests/compute/mytest.go">
          {`package compute

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
        <p className="text-[13px] leading-[20px] text-pretty text-muted-foreground">
          That is the whole contract. The test shows up in{" "}
          <code className="font-mono text-[12px] text-foreground">providerbench list</code>, runs with everything else
          and lands in the JSON report. This site needs no change either: it lays every category out from its reports,
          so a new test or a new category gets its charts with the first published report.
        </p>
      </Step>

      <Step index="04" title="Submit your results">
        <ol className="flex flex-col">
          {(
            [
              ["Run", "Benchmark 10 fresh hosts with 3 repeats each, with --campaign, --sample-index, --repeat-index and --fresh-instance set. CONTRIBUTING.md has the full command."],
              ["Validate", "Run providerbench validate --manifest data/report-manifest.json data/results before you commit."],
              ["Open a pull request", "Reports carry full system info, so anyone can check them or rerun the same plan."],
            ] as const
          ).map(([title, body], i) => (
            <li key={title} className="grid grid-cols-[28px_1fr] gap-x-3 border-t border-border py-3 first:border-t-0 first:pt-0">
              <span className="num text-[12px] leading-5 text-subtle">{i + 1}</span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium">{title}</span>
                <span className="text-[13px] leading-[20px] text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Step>
    </main>
  );
}
