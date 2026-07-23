import type { Metadata } from "next";
import { CodeBlock } from "@/components/code-block";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "CLI",
  description:
    "Install and run the ProviderBench CLI, extend it with your own benchmarks, and submit results.",
};

export default function CliPage() {
  return (
    <main>
      <PageHeader
        eyebrow="CLI"
        title="One binary, ninety seconds, every number on this site"
        lede="A static Go binary with no dependencies, no daemon and no account. Point it at a fresh VPS and get a shareable JSON report."
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <h2 className="mt-12 text-lg font-semibold text-foreground">Install</h2>
        <div className="mt-4 grid gap-4">
          <CodeBlock title="with Go 1.26+">
            {`go install github.com/niklas-schmidt-dev/providerbench/cmd/providerbench@latest`}
          </CodeBlock>
          <CodeBlock title="or build from source">
            {`git clone https://github.com/niklas-schmidt-dev/providerbench
cd providerbench && go build -o providerbench ./cmd/providerbench`}
          </CodeBlock>
        </div>

        <h2 className="mt-14 text-lg font-semibold text-foreground">Run</h2>
        <div className="mt-4 grid gap-4">
          <CodeBlock title="full run with a shareable report">
            {`providerbench run \\
  --provider hetzner --product cloud-vps --plan cax21 \\
  --region fsn1 --price 7.55 --env os_image=ubuntu-24.04 \\
  --json report.json`}
          </CodeBlock>
          <CodeBlock title="pick your tests, go faster">
            {`providerbench run --quick -t cpu,steal     # 20 seconds: compute + overselling only
providerbench run -t disk --dir /mnt/data  # benchmark a specific volume
providerbench list                         # every available test
providerbench system                       # detected hardware & virtualization`}
          </CodeBlock>
        </div>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          For honest numbers: use a <em>fresh</em> instance, run at least twice at
          different times of day, and run nothing else while measuring. The disk
          test writes a 1 GiB file in the working directory (or{" "}
          <code className="font-mono text-xs">--dir</code>) and removes it afterwards.
        </p>

        <h2 className="mt-14 text-lg font-semibold text-foreground">Extend it</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every test implements one interface and registers itself. Adding a
          benchmark — PostgreSQL transactions, Redis ops, S3 upload speed, LLM
          time-to-first-token — is one file.
        </p>
        <div className="mt-4">
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
        </div>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          That's the whole contract. The test now shows up in{" "}
          <code className="font-mono text-xs">providerbench list</code>, runs with
          everything else, and lands in the JSON report.
        </p>

        <h2 className="mt-14 text-lg font-semibold text-foreground">
          Submit your results
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ["1. Run", "Benchmark with --json report.json and the --provider / --plan / --region / --price flags filled in."],
            ["2. Add", "Rename the file provider-plan.json and drop it into data/results/ in the repository."],
            ["3. Open a PR", "Reports carry full system info, so anyone can sanity-check them — or rerun the same plan to verify."],
          ].map(([title, body]) => (
            <Card key={title} className="gap-2 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-sm">{title}</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
