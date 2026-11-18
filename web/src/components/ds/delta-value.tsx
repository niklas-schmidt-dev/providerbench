// Signed change with direction-aware color: green when the movement is an
// improvement for this metric, red when it is a regression.
export function DeltaValue({
  value,
  unit = "%",
  lowerIsBetter = false,
  size = "sm",
  showArrow = true,
  decimals = 1,
}: {
  value: number;
  unit?: string;
  lowerIsBetter?: boolean;
  size?: "sm" | "md" | "lg";
  showArrow?: boolean;
  decimals?: number;
}) {
  const better = lowerIsBetter ? value < 0 : value > 0;
  const flat = value === 0;
  const color = flat
    ? "var(--text-faint)"
    : better
      ? "var(--text-pass)"
      : "var(--text-fail)";
  return (
    <span
      className="pb-num inline-flex items-center gap-[3px]"
      style={{
        color,
        fontSize: size === "lg" ? 15 : size === "md" ? 13 : 12,
        letterSpacing: 0,
      }}
    >
      {showArrow && !flat && (
        <span aria-hidden style={{ fontSize: "0.85em", lineHeight: 1 }}>
          {value > 0 ? "▲" : "▼"}
        </span>
      )}
      {value > 0 ? "+" : ""}
      {value.toFixed(decimals)}
      {unit}
    </span>
  );
}
