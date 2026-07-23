import { TriangleAlert } from "lucide-react";

// Shown wherever the dataset contains illustrative runs. Honesty is the
// product: placeholder numbers must never read as real measurements.
export function SampleBanner() {
  return (
    <p className="flex items-center gap-2 rounded-md border border-warning/35 bg-warning/8 px-3 py-2 text-[13px] text-muted-foreground">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span>
        Rows marked <span className="font-medium text-foreground">sample</span> are
        illustrative placeholders, not measurements. Unmarked rows are real,
        reproducible benchmark runs — submit a report to replace a placeholder.
      </span>
    </p>
  );
}
