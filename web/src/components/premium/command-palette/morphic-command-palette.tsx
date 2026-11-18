"use client";

import { LayoutGroup } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MorphicTooltipProvider } from "@/components/premium/morphic-tooltip/morphic-tooltip";
import { useOnOpen } from "@/lib/hooks/use-on-open";
import { useRowCursor } from "@/lib/hooks/use-row-cursor";
import { PaletteContext } from "./command-palette-context";
import {
  type CommandRow,
  DEFAULT_COMMAND_LABELS,
  type MorphicCommandItem,
  type MorphicCommandPaletteProps,
} from "./command-palette-types";
import { useCommandRows } from "./use-command-rows";

/* ─────────────────────────────────────────────────────────
 * MORPHIC COMMAND PALETTE STORYBOARD
 *
 *  open      the trigger's surface grows into the panel (shared layout);
 *            the content fades in 150ms
 *  type      matches are marked in labels; nested commands surface under
 *            their parent's name; the highlight glides between rows
 *  drill     a command with sub-commands slides its page in from the
 *            right (220ms ease-out); Back or Backspace slides it out
 *            the other way, and the breadcrumb chip fades with it
 *  recent    with no query, the last commands run lead the list
 *  empty     a soft icon and the query echoed back, with a hint
 *  close     the panel shrinks back into the trigger
 *  reduced   no morph, slide, or glide; changes happen in place
 *
 *  Parts
 *    command-palette-trigger.tsx   morphing trigger button
 *    command-palette-content.tsx   dialog shell, backdrop, panel
 *    command-palette-search.tsx    borderless search, breadcrumb, Esc
 *    command-palette-list.tsx      groups, page slide, empty state
 *    command-palette-row.tsx       one command row
 *    command-palette-footer.tsx    key hints and result count
 *    command-palette-kbd.tsx       key chips
 *    use-command-rows.ts           search, nesting, recent grouping
 * ───────────────────────────────────────────────────────── */

/** Owns search, pages, recent commands, and selection. */
export function MorphicCommandPalette({
  items,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  onSelect,
  shortcut = "k",
  defaultRecent = [],
  recentLimit = 3,
  labels: labelOverrides,
}: MorphicCommandPaletteProps) {
  const id = useId();
  const labels = { ...DEFAULT_COMMAND_LABELS, ...labelOverrides };
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<MorphicCommandItem[]>([]);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [recent, setRecent] = useState<string[]>(() =>
    defaultRecent.slice(0, recentLimit),
  );
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = controlledOpen ?? internalOpen;
  const controlled = controlledOpen !== undefined;

  const setOpen = useCallback(
    (next: boolean) => {
      if (next && !open) {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange, open],
  );

  // The shared trigger becomes hidden before the dialog's focus history is
  // captured. Keep its original focus target for the return morph as well.
  useLayoutEffect(() => {
    if (!open || returnFocusRef.current) return;
    const target = document.activeElement;
    if (
      target instanceof HTMLElement &&
      !document.getElementById(`${id}-dialog`)?.contains(target)
    )
      returnFocusRef.current = target;
  }, [id, open]);

  useEffect(() => {
    if (open || !returnFocusRef.current) return;
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const frame = requestAnimationFrame(() => {
      if (target.isConnected) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const { grouped, rows, byId } = useCommandRows({
    items,
    pages,
    query,
    recent: recentLimit > 0 ? recent : [],
    labels,
  });
  // The cursor resets whenever the page or the query changes.
  const cursorKey = `${pages.map((p) => p.id).join("/")}|${query}`;
  const cursorRows = rows.map((row) => ({ id: row.key }));
  const { activeIndex, moveTo, moveActive } = useRowCursor(
    cursorRows,
    cursorKey,
  );

  useOnOpen(open, () => {
    setQuery("");
    setPages([]);
    moveTo(null);
  });

  useEffect(() => {
    if (!shortcut) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== shortcut.toLowerCase()
      )
        return;
      // Don't steal the shortcut from a different modal on the page.
      if (!open && document.querySelector('[role="dialog"][aria-modal="true"]'))
        return;
      event.preventDefault();
      setOpen(!open);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [open, setOpen, shortcut]);

  const back = () => {
    if (!pages.length) return;
    setDirection(-1);
    setPages((list) => list.slice(0, -1));
    setQuery("");
  };

  const select = (row: CommandRow) => {
    // Return the original object, including any consumer metadata.
    const item = byId.get(row.item.id) ?? row.item;
    if (item.children?.length) {
      setDirection(1);
      setPages((list) => [...list, item]);
      setQuery("");
      return;
    }
    if (recentLimit > 0) {
      setRecent((list) =>
        [item.id, ...list.filter((id) => id !== item.id)].slice(0, recentLimit),
      );
    }
    setOpen(false);
    item.onSelect?.();
    onSelect?.(item);
  };

  return (
    <PaletteContext.Provider
      value={{
        id,
        labels,
        open,
        setOpen,
        shortcut,
        query,
        setQuery,
        pages,
        direction,
        back,
        grouped,
        rows,
        activeIndex,
        moveTo,
        moveActive,
        select,
      }}
    >
      <LayoutGroup id={id}>
        <MorphicTooltipProvider>{children}</MorphicTooltipProvider>
      </LayoutGroup>
    </PaletteContext.Provider>
  );
}

export {
  MorphicCommandPaletteContent,
  type MorphicCommandPaletteContentProps,
} from "./command-palette-content";
export {
  MorphicCommandPaletteTrigger,
  type MorphicCommandPaletteTriggerProps,
} from "./command-palette-trigger";
export type {
  MorphicCommandItem,
  MorphicCommandLabels,
  MorphicCommandPaletteProps,
} from "./command-palette-types";
