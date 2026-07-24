import { Info, Plus } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

// Shared chart chrome, artificialanalysis.ai-style: a quiet watermark inside
// the plot, methodology folded into a collapsed footer, and the reproduce
// command as a slim terminal line instead of a boxed widget.

export function ChartWatermark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 inline-flex select-none items-center gap-1.5 text-[10.5px] font-medium text-foreground/30",
        className,
      )}
    >
      <span className="size-1.5 bg-brand/70" />
      ProviderBench
    </span>
  );
}

export function ChartMethodology({
  description,
  sourceHref,
}: {
  description: string;
  sourceHref?: string;
}) {
  return (
    <details className="group border-t">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-2.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info aria-hidden className="size-3 shrink-0" />
        What this measures
        <Plus
          aria-hidden
          className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-45"
        />
      </summary>
      <p className="max-w-prose px-5 pb-3 text-[12px] leading-relaxed text-muted-foreground">
        {description}
        {sourceHref && (
          <>
            {" "}
            <a href={sourceHref} className="text-brand hover:underline">
              source →
            </a>
          </>
        )}
      </p>
    </details>
  );
}

export function ChartCommand({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t py-1 pr-1.5 pl-5">
      <code className="truncate font-mono text-[11.5px] text-muted-foreground">
        <span aria-hidden className="select-none text-muted-foreground/50">
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton text={command} label={`Copy command: ${command}`} />
    </div>
  );
}
