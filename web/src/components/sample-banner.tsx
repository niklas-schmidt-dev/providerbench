import { TriangleAlert } from "lucide-react";

import { DsBadge } from "@/components/ds/badge";

// Shown wherever the dataset contains illustrative runs. Honesty is the
// product: placeholder numbers must never read as real measurements.
export function SampleBanner() {
  return (
    <p className="flex items-center gap-2.5 rounded-md border border-[#efd9ac] bg-(--warn-100) px-3.5 py-2.5 text-[13px] leading-[19px] text-(--text-body)">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        Rows stamped <DsBadge tone="warn">Sample</DsBadge> are illustrative
        placeholders, not measurements. Unmarked rows are real, reproducible
        benchmark runs — submit a report to replace a placeholder.
      </span>
    </p>
  );
}
