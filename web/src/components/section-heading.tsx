import type * as React from "react";

import { cn } from "@/lib/utils";

// Section marker in the artificialanalysis.ai register: a small filled square,
// a plain heading, and a factual one-liner — no kickers, no uppercase.
export function SectionHeading({
  title,
  description,
  meta,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-2",
        className,
      )}
    >
      <div>
        <h2 className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-foreground">
          <span aria-hidden className="size-2 shrink-0 bg-foreground/90" />
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {meta}
    </div>
  );
}
