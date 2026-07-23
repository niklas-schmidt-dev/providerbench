export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {title && (
        <div className="border-b px-4 py-2 font-mono text-[11px] text-muted-foreground">
          {title}
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-foreground/90">
        <code>{children}</code>
      </pre>
    </div>
  );
}
