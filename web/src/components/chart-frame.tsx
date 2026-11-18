import { Info, Plus } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

// Shared chart chrome: a quiet watermark inside the plot, methodology folded
// into a collapsed footer, and the reproduce command as a console strip.

export function ChartWatermark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pb-label pointer-events-none absolute z-10 inline-flex items-center gap-1.5 text-[10px] text-(--text-faint) select-none",
        className,
      )}
    >
      <span className="size-1.5 rounded-[2px] bg-gray-950" />
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
    <details className="group">
      <summary className="pb-label flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[10.5px] text-muted-foreground transition-colors select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info aria-hidden className="size-3 shrink-0" />
        What this measures
        <Plus
          aria-hidden
          className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-45"
        />
      </summary>
      <p className="max-w-prose px-4 pb-3 text-[12px] leading-[18px] text-muted-foreground">
        {description}
        {sourceHref && (
          <>
            {" "}
            <a
              href={sourceHref}
              className="border-b border-(--border-strong) text-foreground hover:border-foreground"
            >
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
    <div className="flex items-center justify-between gap-2 border-t border-(--border-inverse) bg-console py-1 pr-1.5 pl-4">
      <code className="truncate font-mono text-[11.5px] text-console-foreground/85">
        <span aria-hidden className="text-signal select-none">
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton
        text={command}
        label={`Copy command: ${command}`}
        className="text-console-foreground/60 hover:bg-white/10 hover:text-console-foreground"
      />
    </div>
  );
}
