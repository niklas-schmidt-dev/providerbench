"use client";

import { SearchX } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { EASE_IN, EASE_OUT } from "@/lib/ease";
import { usePalette } from "./command-palette-context";
import { CommandPaletteRow } from "./command-palette-row";

const SLIDE = 24;

/**
 * Grouped results. Opening a page slides the old list out left (120ms
 * ease-in), then the new one in from the right (220ms ease-out); going back
 * reverses both.
 */
export const CommandPaletteList = forwardRef<
  HTMLDivElement,
  { emptyMessage?: string; emptyAction?: ReactNode }
>(function CommandPaletteList({ emptyMessage, emptyAction }, ref) {
  const { id, labels, query, pages, direction, grouped, rows } = usePalette();
  const reduce = useReducedMotion();
  const pageKey = pages.map((p) => p.id).join("/") || "root";

  return (
    <div
      ref={ref}
      id={`${id}-results`}
      role="listbox"
      aria-label={pages.at(-1)?.label ?? labels.commands}
      className="relative max-h-[min(55dvh,26rem)] min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-2"
    >
      {/* "wait": the old page leaves before the new one enters, so the two
          lists never draw over each other mid-slide. */}
      <AnimatePresence initial={false} mode="wait" custom={direction}>
        <motion.div
          key={pageKey}
          custom={direction}
          variants={{
            enter: (dir: number) => ({
              opacity: 0,
              x: reduce ? 0 : dir * SLIDE,
            }),
            center: {
              opacity: 1,
              x: 0,
              transition: { duration: reduce ? 0 : 0.22, ease: EASE_OUT },
            },
            exit: (dir: number) => ({
              opacity: 0,
              x: reduce ? 0 : dir * -SLIDE,
              transition: { duration: reduce ? 0 : 0.12, ease: EASE_IN },
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
        >
          {rows.length ? (
            grouped.map(([label, list]) => (
              <fieldset
                aria-label={label}
                key={label}
                className="mb-1 min-w-0 last:mb-0"
              >
                <p
                  aria-hidden
                  className="px-2.5 pt-2 pb-1 text-muted-foreground text-xs"
                >
                  {label}
                </p>
                {list.map((row) => (
                  <CommandPaletteRow
                    key={row.key}
                    row={row}
                    index={rows.indexOf(row)}
                  />
                ))}
              </fieldset>
            ))
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="grid size-10 place-items-center rounded-full border border-border text-muted-foreground">
                <SearchX aria-hidden className="size-4" />
              </span>
              <p className="text-sm">
                {emptyMessage ?? (
                  <>
                    {labels.emptyTitle}{" "}
                    <span className="font-medium">“{query.trim()}”</span>
                  </>
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                {labels.emptyHint}
              </p>
              {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
});
