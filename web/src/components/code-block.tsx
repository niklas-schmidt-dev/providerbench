export function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-(--border-inverse) bg-console">
      {title && (
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="pb-label text-[10px] text-gray-500">{title}</span>
          <span aria-hidden className="led size-1.5 rounded-full bg-signal" />
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-console-foreground/90">
        <code>{children}</code>
      </pre>
    </div>
  );
}
