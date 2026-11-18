import type * as React from "react";

import { cn } from "@/lib/utils";

// Section opener: uppercase eyebrow, display title, one factual note, and an
// optional action cluster on the baseline.
export function SectionHead({
  eyebrow,
  title,
  note,
  right,
  id,
  className,
}: {
  eyebrow?: string;
  title: string;
  note?: React.ReactNode;
  right?: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-5 gap-y-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="pb-label mb-[7px] text-muted-foreground">{eyebrow}</div>}
        <h2 className="text-[26px] leading-8 font-semibold tracking-[-0.02em] text-foreground sm:text-[30px] sm:leading-9">
          {title}
        </h2>
        {note && (
          <p className="mt-[7px] max-w-2xl text-[14px] leading-[21px] text-muted-foreground">
            {note}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

// The measurement freshness line: a pass-green dot plus the cadence facts.
export function Freshness({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
      <span aria-hidden className="led size-1.5 rounded-full bg-success" />
      {children}
    </span>
  );
}
