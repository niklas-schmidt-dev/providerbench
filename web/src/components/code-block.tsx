import { CopyButton } from "@/components/copy-button";

/** A command or source listing: hairline frame, mono text, copy on the title row. */
export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-border pr-1.5 pl-4">
        <span className="text-[12px] text-subtle">{title}</span>
        <CopyButton text={children} label={title ? `Copy: ${title}` : undefined} className="text-subtle hover:text-foreground" />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-[20px]">
        <code>{children}</code>
      </pre>
    </div>
  );
}
