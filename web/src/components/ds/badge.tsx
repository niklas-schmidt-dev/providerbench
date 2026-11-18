import type * as React from "react";

// Status badge with the design system's tone set. Mono variant for values
// (regions, protocol ids); dot for live/status semantics.
const TONES = {
  neutral: { bg: "var(--gray-100)", fg: "var(--gray-700)", bd: "var(--gray-200)" },
  pass: { bg: "var(--pass-100)", fg: "var(--pass-500)", bd: "#bfe3d9" },
  warn: { bg: "var(--warn-100)", fg: "var(--warn-500)", bd: "#efd9ac" },
  fail: { bg: "var(--fail-100)", fg: "var(--fail-500)", bd: "#f2c8c2" },
  info: { bg: "var(--info-100)", fg: "var(--info-500)", bd: "#c4dcf0" },
  signal: { bg: "var(--signal-100)", fg: "var(--signal-700)", bd: "var(--signal-200)" },
  inverse: { bg: "var(--gray-950)", fg: "var(--gray-0)", bd: "var(--gray-950)" },
  outline: { bg: "transparent", fg: "var(--text-muted)", bd: "var(--gray-200)" },
} as const;

export type DsBadgeTone = keyof typeof TONES;

export function DsBadge({
  tone = "neutral",
  mono,
  dot,
  title,
  children,
}: {
  tone?: DsBadgeTone;
  mono?: boolean;
  dot?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className="inline-flex h-5 items-center gap-[5px] rounded-(--radius-xs) border px-[7px] font-medium whitespace-nowrap tabular-nums"
      style={{
        background: t.bg,
        color: t.fg,
        borderColor: t.bd,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: mono ? 11 : 12,
        letterSpacing: mono ? 0 : "-0.005em",
      }}
    >
      {dot && (
        <span
          aria-hidden
          className="size-[5px] rounded-full"
          style={{ background: t.fg }}
        />
      )}
      {children}
    </span>
  );
}
