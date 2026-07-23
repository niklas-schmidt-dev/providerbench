import { TriangleAlert } from "lucide-react";

// Shown wherever the dataset is illustrative. Honesty is the product: never
// let placeholder numbers read as real measurements.
export function SampleBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] px-4 py-3">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Sample data.</span> These
        numbers are illustrative placeholders showing what ProviderBench
        measures — not real measurements of any provider. Run the CLI and submit
        a report to put real data here.
      </p>
    </div>
  );
}
