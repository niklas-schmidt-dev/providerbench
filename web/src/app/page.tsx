import { Dashboard } from "@/components/dashboard/dashboard";
import { HOME_CATEGORY } from "@/lib/categories";
import { loadDashboard } from "@/lib/dashboard-data";

export default function Home() {
  return <Dashboard data={loadDashboard(HOME_CATEGORY)} />;
}
