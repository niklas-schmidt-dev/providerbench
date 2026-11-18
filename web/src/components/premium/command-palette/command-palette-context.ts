"use client";

import { createContext, useContext } from "react";
import type {
  CommandRow,
  MorphicCommandItem,
  MorphicCommandLabels,
} from "./command-palette-types";

export type PaletteContextValue = {
  id: string;
  labels: MorphicCommandLabels;
  open: boolean;
  setOpen: (open: boolean) => void;
  shortcut: string | false;
  query: string;
  setQuery: (query: string) => void;
  /** Parents of the page being shown, outermost first. */
  pages: MorphicCommandItem[];
  /** +1 when a page opened, -1 when one closed; drives the slide. */
  direction: 1 | -1;
  back: () => void;
  grouped: [string, CommandRow[]][];
  rows: CommandRow[];
  activeIndex: number;
  moveTo: (key: string | null) => void;
  moveActive: (direction: 1 | -1) => void;
  select: (row: CommandRow) => void;
};

export const PaletteContext = createContext<PaletteContextValue | null>(null);

export function usePalette() {
  const context = useContext(PaletteContext);
  if (!context)
    throw new Error(
      "MorphicCommandPalette parts must be inside MorphicCommandPalette.",
    );
  return context;
}
