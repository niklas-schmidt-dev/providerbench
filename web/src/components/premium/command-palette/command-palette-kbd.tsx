import { cn } from "@/lib/utils";

/** Keys as small rounded chips, such as ⌘ ⇧ N. */
export function CommandKbd({
  keys,
  className,
}: {
  keys: readonly string[];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)}>
      {keys.map((key, i) => (
        <kbd
          // biome-ignore lint/suspicious/noArrayIndexKey: keys can repeat and never reorder.
          key={`${key}-${i}`}
          className="grid h-5 min-w-5 place-items-center rounded-md border border-border bg-background px-1 font-sans text-muted-foreground text-xs leading-none"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
