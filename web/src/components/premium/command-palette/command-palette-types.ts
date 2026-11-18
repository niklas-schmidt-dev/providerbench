import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type MorphicCommandItem = {
  /** Stable and unique across the palette, nested items included. */
  id: string;
  label: string;
  description?: string;
  group?: string;
  icon?: LucideIcon;
  keywords?: string[];
  /** Keys shown as chips, such as ["⌘", "⇧", "N"]. Display only. */
  shortcut?: string[];
  /** Display hint only; prefer `shortcut` for keys. */
  hint?: string;
  /** Sub-commands. Selecting this item opens them as a page. */
  children?: MorphicCommandItem[];
  onSelect?: () => void;
};

export type MorphicCommandPaletteProps = {
  items: readonly MorphicCommandItem[];
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect?: (item: MorphicCommandItem) => void;
  /** Cmd/Ctrl + this key. Pass false to disable the global shortcut. */
  shortcut?: string | false;
  /** Ids shown under "Recent" before the first search. */
  defaultRecent?: string[];
  /** How many recent commands to keep. 0 turns the section off. */
  recentLimit?: number;
  labels?: Partial<MorphicCommandLabels>;
};

export const DEFAULT_COMMAND_LABELS = {
  title: "Command palette",
  placeholder: "Search commands…",
  pagePlaceholder: "Filter…",
  searchIn: "Search",
  emptyTitle: "No results for",
  emptyHint: "Try a different word.",
  recent: "Recent",
  commands: "Commands",
  navigate: "Move",
  select: "Open",
  back: "Back",
  close: "Close",
  clear: "Clear search",
  result: "result",
  results: "results",
  found: "found",
};

export type MorphicCommandLabels = typeof DEFAULT_COMMAND_LABELS;

/** A row as rendered: the item plus where it came from. */
export type CommandRow = {
  /** Unique per list; recent rows are prefixed so they can repeat. */
  key: string;
  item: MorphicCommandItem;
  group: string;
};
