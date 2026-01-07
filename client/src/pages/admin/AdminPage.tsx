import { Routes, Route } from "react-router-dom";
import { AdminLayout } from "../../components/layout/AdminLayout";
import { AdminDashboard as Dashboard } from "./AdminDashboard";
import { MatchesPage } from "./MatchesPage";
import { UsersManagement } from "./UsersManagement";
import { AdminSettings } from "./AdminSettings";
import { PendingApprovalsPage } from "./PendingApprovalsPage";

export function AdminPage() {
  return (
    <AdminLayout>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="users" element={<UsersManagement />} />
        <Route path="settings" element={<AdminSettings />} />
        <Route path="approvals" element={<PendingApprovalsPage />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </AdminLayout>
  );
}

