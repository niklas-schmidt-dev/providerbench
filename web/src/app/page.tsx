import { Dashboard } from "@/components/dashboard/dashboard";
import { loadDashboard } from "@/lib/dashboard-data";

export default function Home() {
  const { category, report, plans, stats, sample } = loadDashboard("compute");
  return (
    <Dashboard
      categorySlug={category.slug}
      eyebrow={`${category.name} · ${category.tagline}`}
      plans={plans}
      stats={stats}
      tableMetrics={report.tableMetrics}
      scatterMetrics={report.scatterMetrics}
      sample={sample}
    />
  );
}
