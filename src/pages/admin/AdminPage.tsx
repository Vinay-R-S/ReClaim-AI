import { Routes, Route } from "react-router-dom";
import { AdminLayout } from "../../components/layout/AdminLayout";
import { AdminDashboard as Dashboard } from "./AdminDashboard";
import { UsersManagement } from "./UsersManagement";

export function AdminPage() {
  return (
    <AdminLayout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="users" element={<UsersManagement />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </AdminLayout>
  );
}
