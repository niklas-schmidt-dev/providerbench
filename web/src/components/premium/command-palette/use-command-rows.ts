"use client";

import { useMemo } from "react";
import { searchCommands } from "@/lib/command-search";
import type {
  CommandRow,
  MorphicCommandItem,
  MorphicCommandLabels,
} from "./command-palette-types";

/** Every item with its parent's label, depth first. */
function flatten(
  items: readonly MorphicCommandItem[],
  parent?: MorphicCommandItem,
): { item: MorphicCommandItem; parent?: MorphicCommandItem }[] {
  return items.flatMap((item) => [
    { item, parent },
    ...(item.children ? flatten(item.children, item) : []),
  ]);
}

/**
 * The rows to show and how they group.
 *
 * - On a sub-page, its children are searched.
 * - At the root with a query, nested commands are searched too and grouped
 *   under their parent's label, so typing "dark" finds Theme > Dark.
 * - At the root with no query, recent commands lead under "Recent".
 */
export function useCommandRows({
  items,
  pages,
  query,
  recent,
  labels,
}: {
  items: readonly MorphicCommandItem[];
  pages: readonly MorphicCommandItem[];
  query: string;
  recent: readonly string[];
  labels: Pick<MorphicCommandLabels, "recent" | "commands">;
}) {
  const all = useMemo(() => flatten(items), [items]);
  const byId = useMemo(
    () => new Map(all.map(({ item }) => [item.id, item])),
    [all],
  );

  const grouped = useMemo(() => {
    const page = pages.at(-1);
    const searchRoot = !page && query.trim();
    const pool = page
      ? (page.children ?? []).map((item) => ({ item, parent: page }))
      : searchRoot
        ? all
        : items.map((item) => ({ item, parent: undefined }));

    const searchable = pool.map(({ item, parent }) => ({
      label: item.label,
      group: parent ? parent.label : (item.group ?? labels.commands),
      keywords: [...(item.keywords ?? []), item.description ?? ""],
      item,
    }));

    const groups = new Map<string, CommandRow[]>();
    const add = (group: string, row: CommandRow) => {
      const list = groups.get(group) ?? [];
      list.push(row);
      groups.set(group, list);
    };

    if (!page && !query.trim()) {
      for (const id of recent) {
        const item = byId.get(id);
        if (item)
          add(labels.recent, {
            key: `recent:${id}`,
            item,
            group: labels.recent,
          });
      }
    }
    for (const entry of searchCommands(searchable, query)) {
      add(entry.group, {
        key: entry.item.id,
        item: entry.item,
        group: entry.group,
      });
    }
    return Array.from(groups.entries());
  }, [all, byId, items, labels.commands, labels.recent, pages, query, recent]);

  const rows = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);
  return { grouped, rows, byId };
}
