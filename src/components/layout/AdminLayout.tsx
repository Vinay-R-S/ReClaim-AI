import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  LogOut,
  User,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";

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
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  // Get user initials for avatar fallback
  const getUserInitials = () => {
    if (user?.displayName) {
      return user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "AD";
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-16 px-4 flex items-center gap-2 border-b border-border">
          <img
            src="/Logo.png"
            alt="ReClaim AI Logo"
            className="w-10 h-10 object-contain rounded-full"
          />
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

            {/* User Avatar & Menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-9 h-9 rounded-full transition-colors flex items-center justify-center overflow-hidden border border-transparent hover:border-gray-200"
              >
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || "Admin"}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                    {getUserInitials()}
                  </div>
                )}
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-surface/80 backdrop-blur-md rounded-xl border border-border shadow-lg py-2 z-50">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      {user?.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || "Admin"}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                          {getUserInitials()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text-primary truncate">
                          {user?.displayName || "Admin User"}
                        </p>
                        <p className="text-sm text-text-secondary truncate">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-2">
                    <button className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors">
                      <User className="w-5 h-5 text-text-secondary" />
                      <span>Profile</span>
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors">
                      <Settings className="w-5 h-5 text-text-secondary" />
                      <span>Settings</span>
                    </button>
                  </div>

                  {/* Sign Out */}
                  <div className="border-t border-border pt-2">
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-3 px-4 py-2 text-google-red hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="w-5 h-5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
