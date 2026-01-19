import { Routes, Route } from "react-router-dom";
import { AdminLayout } from "../../components/layout/AdminLayout";
import { MainDashboard } from "./MainDashboard";
import { AdminDashboard as AllItemsPage } from "./AdminDashboard";
import { MatchesPage } from "./MatchesPage";
import { UsersManagement } from "./UsersManagement";
import { AdminSettings } from "./AdminSettings";
import { AdminProfile } from "./AdminProfile";
import { PendingApprovalsPage } from "./PendingApprovalsPage";
import { HandoversPage } from "./HandoversPage"; // [NEW]

export function AdminPage() {
  return (
    <AdminLayout>
      <Routes>
        <Route index element={<MainDashboard />} />
        <Route path="dashboard" element={<MainDashboard />} />
        <Route path="items" element={<AllItemsPage />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="users" element={<UsersManagement />} />
        <Route path="handovers" element={<HandoversPage />} /> {/* [NEW] */}
        <Route path="settings" element={<AdminSettings />} />
        <Route path="profile" element={<AdminProfile />} />
        <Route path="approvals" element={<PendingApprovalsPage />} />
        <Route path="*" element={<MainDashboard />} />
      </Routes>
    </AdminLayout>
  );
}
