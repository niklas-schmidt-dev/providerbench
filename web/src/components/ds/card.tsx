import type * as React from "react";

import { cn } from "@/lib/utils";

// The one data surface: white card, hairline border, small radius, flat.
// `flush` removes body padding so tables can run edge to edge.
export function DsCard({
  eyebrow,
  title,
  subtitle,
  actions,
  footer,
  flush,
  padding = "var(--pad-card)",
  className,
  id,
  children,
}: {
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  padding?: string;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const head = title || eyebrow || actions;
  return (
    <section
      id={id}
      className={cn(
        "overflow-hidden rounded-md border border-(--border-hairline) bg-card shadow-(--shadow-xs)",
        className,
      )}
    >
      {head && (
        <header
          className={cn(
            "flex items-start justify-between gap-4 pt-3.5 pb-3",
            flush && "border-b border-(--border-hairline)",
          )}
          style={{ paddingInline: flush ? 16 : padding }}
        >
          <div className="min-w-0">
            {eyebrow && <div className="pb-label mb-[5px] text-muted-foreground">{eyebrow}</div>}
            {title && (
              <h3
                className="font-semibold text-foreground"
                style={{
                  fontSize: "var(--heading-2-size)",
                  lineHeight: "var(--heading-2-line)",
                  letterSpacing: "var(--heading-2-track)",
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-[3px] text-[13px] leading-[19px] text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div
        style={{
          padding: flush ? 0 : `${head ? "4px" : padding} ${padding} ${padding}`,
        }}
      >
        {children}
      </div>
      {footer && (
        <footer
          className="border-t border-(--border-hairline) bg-(--surface-inset) py-3 text-[13px] leading-[19px] text-muted-foreground"
          style={{ paddingInline: flush ? 16 : padding }}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}
