"use client";

import { usePalette } from "./command-palette-context";
import { CommandKbd } from "./command-palette-kbd";

/** Key hints and the live result count. */
export function CommandPaletteFooter() {
  const { labels, pages, rows } = usePalette();
  // Recent rows repeat commands listed below them; count each once.
  const count = new Set(rows.map((row) => row.item.id)).size;

  return (
    <div className="flex shrink-0 items-center gap-4 border-border border-t px-4 py-2.5 text-muted-foreground text-xs">
      <span className="inline-flex items-center gap-1.5">
        <CommandKbd keys={["↑", "↓"]} />
        {labels.navigate}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <CommandKbd keys={["↵"]} />
        {labels.select}
      </span>
      {pages.length ? (
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <CommandKbd keys={["⌫"]} />
          {labels.back}
        </span>
      ) : null}
      <span className="ml-auto tabular-nums">
        {count} {count === 1 ? labels.result : labels.results}
      </span>
      <output className="sr-only">
        {count} {count === 1 ? labels.result : labels.results} {labels.found}.
      </output>
    </div>
  );
}
