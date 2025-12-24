import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Link2,
  MapPin,
  ArrowLeftRight,
  Users,
  UserCheck,
  Settings,
  Bell,
  Search,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface AdminLayoutProps {
  children: React.ReactNode;
}

const sidebarSections = [
  {
    title: "OVERVIEW",
    items: [
      { name: "Dashboard", path: "/admin", icon: LayoutDashboard, badge: null },
      { name: "All Items", path: "/admin/items", icon: Package, badge: 24 },
      { name: "Matches", path: "/admin/matches", icon: Link2, badge: 8 },
    ],
  },
  {
    title: "MANAGEMENT",
    items: [
      {
        name: "Collection Offices",
        path: "/admin/offices",
        icon: MapPin,
        badge: null,
      },
      {
        name: "Handovers",
        path: "/admin/handovers",
        icon: ArrowLeftRight,
        badge: null,
      },
      { name: "Users", path: "/admin/users", icon: Users, badge: null },
    ],
  },
  {
    title: "ADMIN",
    items: [
      {
        name: "Pending Approvals",
        path: "/admin/approvals",
        icon: UserCheck,
        badge: 2,
      },
      {
        name: "Settings",
        path: "/admin/settings",
        icon: Settings,
        badge: null,
      },
    ],
  },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-16 px-4 flex items-center gap-2 border-b border-border">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-google-blue via-google-red to-google-yellow flex items-center justify-center">
            <span className="text-white font-bold text-lg">R</span>
          </div>
          <span className="font-medium text-xl text-text-primary">ReClaim</span>
          <span className="ml-2 px-2 py-0.5 bg-primary text-white text-xs font-medium rounded">
            ADMIN
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
          {sidebarSections.map((section) => (
            <div key={section.title}>
              <h3 className="px-3 mb-2 text-xs font-medium text-text-secondary tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={cn(
                        "sidebar-link",
                        isActive
                          ? "sidebar-link-active"
                          : "sidebar-link-inactive"
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                      <span className="flex-1">{item.name}</span>
                      {item.badge && (
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            isActive
                              ? "bg-primary text-white"
                              : "bg-gray-200 text-text-secondary"
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Header */}
        <header className="h-16 bg-surface border-b border-border px-6 flex items-center justify-between">
          <h1 className="text-xl font-medium text-text-primary">Dashboard</h1>

          <div className="flex items-center gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                placeholder="Search items, users..."
                className="w-64 pl-10 pr-4 py-2 rounded-lg border border-border bg-gray-50 text-sm 
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            {/* Notifications */}
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors relative">
              <Bell className="w-5 h-5 text-text-secondary" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-google-red rounded-full"></span>
            </button>

            {/* User Avatar */}
            <button className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
              AD
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
