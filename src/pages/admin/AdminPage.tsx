import { AdminLayout } from "../../components/layout/AdminLayout";
import { AdminDashboard as Dashboard } from "./AdminDashboard";

export function AdminPage() {
  return (
    <AdminLayout>
      <Dashboard />
    </AdminLayout>
  );
}
