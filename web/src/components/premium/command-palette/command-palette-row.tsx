"use client";

import { ChevronRight, Command, CornerDownLeft } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { HighlightMatch } from "@/components/motion/highlight-match";
import { SPRING_GLIDE } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette-context";
import { CommandKbd } from "./command-palette-kbd";
import type { CommandRow } from "./command-palette-types";

/**
 * One command: icon chip, label with the match marked, description, and
 * either its shortcut, a chevron when it opens a page, or an Enter hint on
 * the highlighted row. The highlight glides between rows.
 */
export function CommandPaletteRow({
  row,
  index,
}: {
  row: CommandRow;
  index: number;
}) {
  const { id, query, activeIndex, moveTo, select } = usePalette();
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const selected = index === activeIndex;
  const { item } = row;
  const Icon = item.icon ?? Command;
  const nested = Boolean(item.children?.length);

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-haspopup={nested ? "listbox" : undefined}
      id={`${id}-option-${index}`}
      data-index={index}
      tabIndex={-1}
      onPointerMove={(event) => {
        if (canHover && event.pointerType === "mouse" && !selected)
          moveTo(row.key);
      }}
      onClick={() => select(row)}
      className="relative isolate flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {selected ? (
        <motion.span
          layoutId={reduce ? undefined : `${id}-cursor`}
          transition={reduce ? { duration: 0 } : SPRING_GLIDE}
          className="absolute inset-0 -z-10 rounded-xl bg-muted"
        />
      ) : null}
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors duration-150",
          selected && "text-foreground",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <HighlightMatch text={item.label} query={query} />
        </span>
        {item.description ? (
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.shortcut?.length ? (
        <CommandKbd keys={item.shortcut} />
      ) : item.hint ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          {item.hint}
        </span>
      ) : null}
      {nested ? (
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : !item.shortcut?.length && !item.hint ? (
        <CornerDownLeft
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-opacity duration-150",
            selected ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </button>
  );
}
