"use client";

import { ChevronLeft, Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef } from "react";
import { Button } from "@/components/motion/button";
import { Input } from "@/components/motion/input";
import { MorphicTooltip } from "@/components/premium/morphic-tooltip/morphic-tooltip";
import { EASE_IN, EASE_OUT } from "@/lib/ease";
import { useTouchCapable } from "@/lib/hooks/use-touch-capable";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette-context";
import { CommandKbd } from "./command-palette-kbd";

/**
 * Borderless search row. Inside a sub-page a breadcrumb chip leads the field
 * (it doubles as a back button), and Backspace on an empty field goes back.
 */
export const CommandPaletteSearch = forwardRef<
  HTMLInputElement,
  { placeholder: string }
>(function CommandPaletteSearch({ placeholder }, ref) {
  const {
    id,
    labels,
    setOpen,
    query,
    setQuery,
    pages,
    back,
    rows,
    activeIndex,
    moveTo,
    moveActive,
    select,
  } = usePalette();
  const reduce = useReducedMotion();
  const canTouch = useTouchCapable();
  const page = pages.at(-1);
  const activeRow = rows[activeIndex];
  const fieldLabel = page ? `${labels.searchIn} ${page.label}` : placeholder;

  return (
    <div className="flex shrink-0 items-center gap-2 border-border border-b px-4">
      <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <AnimatePresence initial={false} mode="popLayout">
        {page ? (
          <motion.button
            key={page.id}
            type="button"
            onClick={back}
            aria-label={`${labels.back}: ${page.label}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 6 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: reduce ? 0 : 0.22, ease: EASE_OUT },
            }}
            exit={{
              opacity: 0,
              transition: { duration: reduce ? 0 : 0.12, ease: EASE_IN },
            }}
            className="flex h-6 shrink-0 items-center gap-0.5 rounded-full bg-muted pr-2 pl-1 text-foreground text-xs transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            {page.label}
          </motion.button>
        ) : null}
      </AnimatePresence>
      <Input
        ref={ref}
        value={query}
        onChange={setQuery}
        placeholder={page ? labels.pagePlaceholder : placeholder}
        aria-label={fieldLabel}
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls={`${id}-results`}
        aria-activedescendant={
          activeRow ? `${id}-option-${activeIndex}` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveActive(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            moveTo((event.key === "Home" ? rows[0] : rows.at(-1))?.key ?? null);
          } else if (event.key === "Enter" && activeRow) {
            event.preventDefault();
            select(activeRow);
          } else if (event.key === "Backspace" && !query && page) {
            event.preventDefault();
            back();
          }
        }}
        // Borderless: the panel's divider frames the field instead.
        className="min-w-0 flex-1"
        classNames={{
          field: "h-14 rounded-none border-0 bg-transparent ring-0",
          input: cn(
            "px-0 placeholder:text-muted-foreground",
            canTouch && "text-base",
          ),
        }}
      />
      {query ? (
        <MorphicTooltip content={labels.clear} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.clear}
            onClick={() => setQuery("")}
            className="size-7 shrink-0 rounded-full"
          >
            <X aria-hidden className="size-3.5" />
          </Button>
        </MorphicTooltip>
      ) : null}
      <MorphicTooltip content={labels.close} side="bottom">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={labels.close}
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CommandKbd keys={["Esc"]} />
        </button>
      </MorphicTooltip>
    </div>
  );
});
