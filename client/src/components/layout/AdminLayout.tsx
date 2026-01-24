import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Link2,
  ArrowLeftRight,
  Users,
  UserCheck,
  Settings,
  LogOut,
  User,
  Video,
  Menu,
  X,
} from "@/lib/icons";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";
import { getItems } from "../../services/itemService";
import { getAllMatches } from "../../services/matchService";

interface AdminLayoutProps {
  children: React.ReactNode;
}

interface SidebarCounts {
  allItems: number;
  matches: number;
  pendingItems: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function AdminLayout({ children }: AdminLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [counts, setCounts] = useState<SidebarCounts>({
    allItems: 0,
    matches: 0,
    pendingItems: 0,
  });
  const [cctvEnabled, setCctvEnabled] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch real-time counts from API
  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [items, matches] = await Promise.all([
          getItems(),
          getAllMatches(),
        ]);

        const pendingItems = items.filter(
          (item) => item.status === "Pending",
        ).length;

        setCounts({
          allItems: items.length, // Total items (Lost + Found)
          matches: matches.length,
          pendingItems: pendingItems,
        });
      } catch (error) {
        console.error("Failed to fetch sidebar counts:", error);
      }
    };

    fetchCounts();

    // Refresh counts every 30 seconds
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch cctvEnabled setting
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          setCctvEnabled(data.cctvEnabled !== false);
        }
      } catch (error) {
        console.error("Failed to fetch settings:", error);
      }
    };
    fetchSettings();
  }, []);

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

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

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

  // Build sidebar sections with dynamic counts
  const sidebarSections = [
    {
      title: "OVERVIEW",
      items: [
        {
          name: "Dashboard",
          path: "/admin",
          icon: LayoutDashboard,
          badge: null,
        },
        {
          name: "All Items",
          path: "/admin/items",
          icon: Package,
          badge: counts.allItems || null,
        },
        {
          name: "Matches",
          path: "/admin/matches",
          icon: Link2,
          badge: counts.matches || null,
        },
      ],
    },
    {
      title: "MANAGEMENT",
      items: [
        {
          name: "CCTV Intelligence",
          path: "/admin/cctv",
          icon: Video,
          badge: null,
          disabled: !cctvEnabled,
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
          badge: counts.pendingItems || null,
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

  // Sidebar content component (reused in both desktop and mobile)
  const SidebarContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <>
      {/* Logo */}
      <div
        className={cn(
          "h-16 px-4 flex items-center gap-2 border-b border-border",
          isMobile && "justify-between",
        )}
      >
        <Link to="/" className="flex items-center gap-2">
          <img
            src="/Logo.webp"
            alt="ReClaim AI Logo"
            width={40}
            height={40}
            className="w-10 h-10 object-contain rounded-full"
          />
          <span className="font-medium text-xl text-text-primary">ReClaim</span>
        </Link>
        <span className="ml-2 px-2 py-0.5 bg-primary text-white text-xs font-medium rounded">
          ADMIN
        </span>
        {isMobile && (
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-6 h-6 text-text-secondary" />
          </button>
        )}
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
                const isDisabled = "disabled" in item && item.disabled;

                // Render disabled items as a div instead of Link
                if (isDisabled) {
                  return (
                    <div
                      key={item.path}
                      className="sidebar-link opacity-50 cursor-not-allowed"
                      title="Feature disabled - Enable in Settings"
                    >
                      <item.icon className="w-5 h-5 text-gray-400" />
                      <span className="flex-1 text-gray-400">{item.name}</span>
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        Off
                      </span>
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "sidebar-link",
                      isActive
                        ? "sidebar-link-active"
                        : "sidebar-link-inactive",
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="flex-1">{item.name}</span>
                    {item.badge !== null && item.badge > 0 && (
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium",
                          isActive
                            ? "bg-primary text-white"
                            : "bg-gray-200 text-text-secondary",
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

      {/* Mobile: Sign out button at bottom */}
      {isMobile && (
        <div className="p-4 border-t border-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-google-red hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign out
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar - Hidden below 1024px (lg) */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-border flex-col fixed h-screen">
        <SidebarContent />
      </aside>

      {/* Mobile Slide-out Drawer */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 lg:hidden animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer */}
          <aside className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-white shadow-xl z-50 lg:hidden flex flex-col animate-slide-in-left">
            <SidebarContent isMobile />
          </aside>
        </>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-64">
        {/* Top Header - White background */}
        <header className="h-16 bg-white border-b border-border px-4 lg:px-6 flex items-center justify-between sticky top-0 z-40">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6 text-text-primary" />
          </button>

          <h1 className="text-lg lg:text-xl font-medium text-text-primary">
            Dashboard
          </h1>

          <div className="flex items-center gap-4">
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
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                    {getUserInitials()}
                  </div>
                )}
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl border border-border shadow-lg py-2 z-50">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      {user?.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || "Admin"}
                          className="w-10 h-10 rounded-full object-cover"
                          referrerPolicy="no-referrer"
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
                    <button
                      onClick={() => {
                        navigate("/admin/profile");
                        setShowUserMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors"
                    >
                      <User className="w-5 h-5 text-text-secondary" />
                      <span>Profile</span>
                    </button>
                    <button
                      onClick={() => {
                        navigate("/admin/settings");
                        setShowUserMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors"
                    >
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
        <main className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
