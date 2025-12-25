import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, HelpCircle, LogOut, User, Settings } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";

interface UserLayoutProps {
  children: React.ReactNode;
}

const navTabs = [
  { name: "Assistant", path: "/app" },
  { name: "My Reports", path: "/app/reports" },
  { name: "Matches", path: "/app/matches" },
  { name: "Collection Points", path: "/app/collection-points" },
];

export function UserLayout({ children }: UserLayoutProps) {
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
    return "U";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="bg-surface border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/app" className="flex items-center gap-2">
            <img
              src="/Logo.png"
              alt="ReClaim AI Logo"
              className="w-10 h-10 object-contain rounded-full"
            />
            <span className="font-medium text-xl text-text-primary">
              ReClaim AI
            </span>
          </Link>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-gray-100 p-1 rounded-pill">
            {navTabs.map((tab) => (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  "nav-tab",
                  location.pathname === tab.path
                    ? "nav-tab-active"
                    : "nav-tab-inactive"
                )}
              >
                {tab.name}
              </Link>
            ))}
          </nav>

          {/* Right Side Actions */}
          <div className="flex items-center gap-3">
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
              <Bell className="w-5 h-5 text-text-secondary" />
            </button>
            <button className="p-2 rounded-full hover:bg-gray-100 transition-colors">
              <HelpCircle className="w-5 h-5 text-text-secondary" />
            </button>

            {/* User Menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-1 rounded-full hover:bg-gray-100 transition-colors"
              >
                {user?.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || "User"}
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                    {getUserInitials()}
                  </div>
                )}
              </button>

              {/* Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-72 bg-surface rounded-xl border border-border shadow-lg py-2 z-50">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-3">
                      {user?.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || "User"}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                          {getUserInitials()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text-primary truncate">
                          {user?.displayName || "User"}
                        </p>
                        <p className="text-sm text-text-secondary truncate">
                          {user?.email}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Menu Items */}
                  <div className="py-2">
                    {user?.email === import.meta.env.VITE_ADMIN_EMAIL && (
                      <Link
                        to="/admin"
                        className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors"
                      >
                        <Settings className="w-5 h-5 text-google-blue" />
                        <span>Admin Dashboard</span>
                      </Link>
                    )}
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
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Main Chat Area */}
          <div className="flex-1 max-w-3xl">{children}</div>

          {/* Right Sidebar */}
          <aside className="hidden lg:block w-80">
            {/* Recent Activity */}
            <div className="card p-4 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-text-primary">
                  Recent Activity
                </h3>
                <button className="text-sm text-primary font-medium hover:underline">
                  View all
                </button>
              </div>
              <div className="space-y-3">
                <ActivityItem
                  icon="✓"
                  iconBg="bg-google-green"
                  title="Match found: Black keys"
                  time="2 hours ago"
                />
                <ActivityItem
                  icon="📦"
                  iconBg="bg-google-yellow"
                  title="Lost item reported: Wallet"
                  time="Yesterday"
                />
                <ActivityItem
                  icon="💰"
                  iconBg="bg-google-blue"
                  title="+50 credits earned"
                  time="3 days ago"
                />
              </div>
            </div>

            {/* Credits Card */}
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-google-yellow/20 flex items-center justify-center">
                  <span className="text-2xl">🪙</span>
                </div>
                <div>
                  <p className="text-3xl font-medium text-text-primary">250</p>
                  <p className="text-sm text-text-secondary">
                    Total credits earned
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

interface ActivityItemProps {
  icon: string;
  iconBg: string;
  title: string;
  time: string;
}

function ActivityItem({ icon, iconBg, title, time }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-white text-sm",
          iconBg
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm text-text-primary">{title}</p>
        <p className="text-xs text-text-secondary">{time}</p>
      </div>
    </div>
  );
}
