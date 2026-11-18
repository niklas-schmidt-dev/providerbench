"use client";

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";
import { EASE_IN, EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette-context";
import { CommandPaletteFooter } from "./command-palette-footer";
import { CommandPaletteList } from "./command-palette-list";
import { CommandPaletteSearch } from "./command-palette-search";

export type MorphicCommandPaletteContentProps = {
  title?: string;
  placeholder?: string;
  /** Replaces the default "No results for …" line. */
  emptyMessage?: string;
  /** Shown under the empty state, such as a "Search docs" button. */
  emptyAction?: ReactNode;
  /** Replaces the key hints and result count. */
  footer?: ReactNode;
  className?: string;
};

/** rounded-2xl, in px so motion can keep it true while the panel resizes. */
const PANEL_RADIUS = 16;

const MotionPanel = motion.create(DialogPanel);
const MotionBackdrop = motion.create(DialogBackdrop);

/** The dialog: backdrop, morphing panel, search, results, and footer. */
export function MorphicCommandPaletteContent({
  title,
  placeholder,
  emptyMessage,
  emptyAction,
  footer,
  className,
}: MorphicCommandPaletteContentProps) {
  const { id, labels, open, setOpen, rows, activeIndex } = usePalette();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const activeRow = rows[activeIndex];

  useEffect(() => {
    if (!open || !activeRow) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, activeRow]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <PresenceGate key="palette">
          {({ isPresent, gate }) => (
            <Dialog
              static
              open={isPresent}
              onClose={() => setOpen(false)}
              initialFocus={inputRef}
              id={`${id}-dialog`}
              className="fixed inset-0 z-[100]"
              inert={!isPresent}
            >
              <MotionBackdrop
                {...gate}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduce ? 0 : 0.15, ease: EASE_OUT }}
                className="fixed inset-0 bg-foreground/10 backdrop-blur-md"
              />
              <div className="pointer-events-none fixed inset-0 flex items-start justify-center px-3 pt-[min(16vh,6rem)] pb-3 sm:px-6 sm:pb-6">
                <MotionPanel
                  {...gate}
                  layout={!reduce}
                  layoutId={reduce ? undefined : `${id}-surface`}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  // Closing: the panel layer fades fast so only the plain
                  // surface is seen shrinking back into the trigger.
                  exit={{
                    opacity: 0,
                    transition: { duration: reduce ? 0 : 0.12, ease: EASE_IN },
                  }}
                  transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                  // Radius as a style, not a class: layout animation scales
                  // the panel as results change, and motion only corrects
                  // corner radius it can read from style. Merged with the
                  // gate's style so pointer events still turn off on close.
                  style={{ ...gate.style, borderRadius: PANEL_RADIUS }}
                  className={cn(
                    "pointer-events-auto flex max-h-[calc(100dvh-7rem)] w-full max-w-xl flex-col overflow-hidden border border-border bg-background text-foreground",
                    className,
                  )}
                >
                  <motion.div
                    layout={reduce ? false : "position"}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    // Content leaves first, before the panel starts to
                    // shrink, so text is never seen squashing.
                    exit={{
                      opacity: 0,
                      transition: {
                        duration: reduce ? 0 : 0.08,
                        ease: EASE_IN,
                      },
                    }}
                    transition={{ duration: reduce ? 0 : 0.15, ease: EASE_OUT }}
                    className="flex min-h-0 flex-col"
                  >
                    <DialogTitle className="sr-only">
                      {title ?? labels.title}
                    </DialogTitle>
                    <CommandPaletteSearch
                      ref={inputRef}
                      placeholder={placeholder ?? labels.placeholder}
                    />
                    <CommandPaletteList
                      ref={listRef}
                      emptyMessage={emptyMessage}
                      emptyAction={emptyAction}
                    />
                    {footer ?? <CommandPaletteFooter />}
                  </motion.div>
                </MotionPanel>
              </div>
            </Dialog>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>
  );
}
