export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {eyebrow && <div className="mb-1.5 text-[12px] text-muted-foreground">{eyebrow}</div>}
        <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {lede && (
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-muted-foreground">{lede}</p>
        )}
        {children}
      </div>
    </div>
  );
}
