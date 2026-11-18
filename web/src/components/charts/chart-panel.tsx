import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One full-width chart region: a quiet title row with its controls, the
 * plot, and a footnote that says what was measured. No card chrome — panels
 * are separated by hairlines, the data is the only loud thing.
 */
export function ChartPanel({
  id,
  title,
  description,
  controls,
  footer,
  children,
  className,
  anchors,
}: {
  /** Extra in-page link targets at the top of the panel (e.g. one per metric). */
  anchors?: string[];
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn("relative border-b border-border px-4 py-6 sm:px-7 sm:py-7", className)}
    >
      {anchors?.map((anchor) => (
        <span key={anchor} id={anchor} aria-hidden className="absolute top-0" />
      ))}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id ? `${id}-title` : undefined} className="text-base font-medium tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="max-w-[68ch] text-[13px] text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {controls && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{controls}</div>}
      </div>
      <div className="mt-5">{children}</div>
      {footer && (
        <div className="mt-4 max-w-[80ch] text-[12px] leading-[18px] text-pretty text-subtle">{footer}</div>
      )}
    </section>
  );
}

/** Text-button toggle group in the reference style: the active option is ink, the rest recede. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-3">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative h-8 text-[13px] transition-colors",
              "after:absolute after:inset-x-0 after:bottom-1 after:h-px after:transition-colors",
              active
                ? "text-foreground after:bg-foreground"
                : "text-subtle after:bg-transparent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A checkbox-style toggle (e.g. "Pareto line"). */
export function ToggleCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-8 items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground aria-checked:text-foreground"
    >
      <span
        aria-hidden
        className={cn(
          "grid size-3.5 place-items-center rounded-[3px] border transition-colors",
          checked ? "border-foreground bg-foreground" : "border-border-strong",
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-2.5 text-background">
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}
