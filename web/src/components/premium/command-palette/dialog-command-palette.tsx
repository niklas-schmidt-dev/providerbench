"use client";

import { Search } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
  AnimatedModal,
  AnimatedModalTitle,
} from "@/components/motion/animated-modal";
import { Button, type ButtonProps } from "@/components/motion/button";
import { cn } from "@/lib/utils";
import { usePalette } from "./command-palette-context";
import { CommandPaletteFooter } from "./command-palette-footer";
import { CommandKbd } from "./command-palette-kbd";
import { CommandPaletteList } from "./command-palette-list";
import { CommandPaletteSearch } from "./command-palette-search";

/* ─────────────────────────────────────────────────────────
 * DIALOG COMMAND PALETTE STORYBOARD
 *
 *  open      a plain dialog near the top of the screen: the backdrop
 *            fades in while the panel grows out of the trigger (or the
 *            focused element, for the shortcut) on the panel spring;
 *            the trigger stays where it is
 *  type      same search, highlight, drill-in pages, and recent list as
 *            the morphic palette
 *  close     the panel shrinks back toward where it opened in 150ms
 *  reduced   quick fades only
 *
 *  It shares the root, search, list, rows, and footer with the morphic
 *  palette, and swaps the morphing shell for the shared AnimatedModal.
 * ───────────────────────────────────────────────────────── */

/** The shared root; it owns search, pages, recent commands, and selection. */
export { MorphicCommandPalette as CommandPalette } from "./morphic-command-palette";

export type CommandPaletteDialogContentProps = {
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

/** The palette as a standard dialog: search, results, and footer. */
export function CommandPaletteDialogContent({
  title,
  placeholder,
  emptyMessage,
  emptyAction,
  footer,
  className,
}: CommandPaletteDialogContentProps) {
  const { labels, open, setOpen, rows, activeIndex } = usePalette();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRow = rows[activeIndex];

  // Typing should land in the search field the moment the dialog opens.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !activeRow) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, activeRow]);

  return (
    <AnimatedModal
      open={open}
      onOpenChange={setOpen}
      // A search box belongs near the top, above the phone keyboard, so
      // this stays a dialog on phones rather than a bottom sheet.
      mobileSheet={false}
      viewportClassName="inset-x-3 top-[min(16vh,6rem)] bottom-3 sm:inset-x-6 sm:bottom-6 [&>div]:items-start"
      panelClassName={cn(
        "flex max-h-[calc(100dvh-7rem)] max-w-xl flex-col overflow-hidden",
        className,
      )}
    >
      <AnimatedModalTitle className="sr-only">
        {title ?? labels.title}
      </AnimatedModalTitle>
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
    </AnimatedModal>
  );
}

export type CommandPaletteTriggerProps = Omit<ButtonProps, "variant">;

/** A search-style button that opens the dialog. It stays put while open. */
export function CommandPaletteTrigger({
  children,
  className,
  onClick,
  ...props
}: CommandPaletteTriggerProps) {
  const { open, setOpen, shortcut } = usePalette();

  return (
    <Button
      variant="outline"
      {...props}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(true);
      }}
      className={cn(
        "h-10 gap-3 px-4 font-normal text-sm hover:border-foreground/20 hover:bg-transparent",
        className,
      )}
    >
      {children ?? (
        <>
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <span>Search commands</span>
          {shortcut ? (
            <CommandKbd keys={["⌘", shortcut.toUpperCase()]} className="ml-4" />
          ) : null}
        </>
      )}
    </Button>
  );
}
