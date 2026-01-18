import { useState, useRef, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { HelpCircle, LogOut, User, Settings } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../context/AuthContext";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface UserLayoutProps {
  children: React.ReactNode;
}

const navTabs = [
  { name: "Assistant", path: "/app" },
  { name: "My Reports", path: "/app/reports" },
  { name: "Handovers", path: "/app/handovers" },
];

export function UserLayout({ children }: UserLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [credits, setCredits] = useState(() => {
    // Initialize from sessionStorage if available
    const cached = sessionStorage.getItem("userCredits");
    return cached ? parseInt(cached, 10) : 0;
  });
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

  // Fetch credits only once per session
  useEffect(() => {
    if (!user?.uid) return;

    // Check if we already have fresh credits in sessionStorage
    const cachedCredits = sessionStorage.getItem("userCredits");
    const cacheTimestamp = sessionStorage.getItem("userCreditsTimestamp");
    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Use cache if it's less than 5 minutes old
    if (
      cachedCredits &&
      cacheTimestamp &&
      now - parseInt(cacheTimestamp, 10) < CACHE_DURATION
    ) {
      setCredits(parseInt(cachedCredits, 10));
      return;
    }

    // Fetch fresh credits
    fetch(`${API_URL}/api/credits/${user.uid}`)
      .then((res) => res.json())
      .then((data) => {
        const newCredits = data.credits || 0;
        setCredits(newCredits);
        // Cache the result
        sessionStorage.setItem("userCredits", newCredits.toString());
        sessionStorage.setItem("userCreditsTimestamp", now.toString());
      })
      .catch((err) => console.error("Failed to fetch credits:", err));
  }, [user?.uid]);

  // Listen for credit updates (e.g., after handover)
  useEffect(() => {
    const handleCreditUpdate = (event: CustomEvent) => {
      const newCredits = event.detail.credits;
      setCredits(newCredits);
      sessionStorage.setItem("userCredits", newCredits.toString());
      sessionStorage.setItem("userCreditsTimestamp", Date.now().toString());
    };

    window.addEventListener("creditsUpdated" as any, handleCreditUpdate);
    return () =>
      window.removeEventListener("creditsUpdated" as any, handleCreditUpdate);
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

  const isHowItWorksPage = location.pathname === "/app/how-it-works";

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header
        className={`${isHowItWorksPage ? "bg-white" : "bg-surface"} border-b border-border sticky top-0 z-50`}
      >
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link to="/app" className="flex items-center gap-2">
            <img
              src="/Logo.webp"
              alt="ReClaim AI Logo"
              width={40}
              height={40}
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
                    : "nav-tab-inactive",
                )}
              >
                {tab.name}
              </Link>
            ))}
          </nav>

          {/* Right Side Actions */}
          <div className="flex items-center gap-3">
            <Link
              to="/app/how-it-works"
              className="p-2 rounded-full hover:bg-gray-100 transition-colors"
              aria-label="How it works"
            >
              <HelpCircle className="w-5 h-5 text-text-secondary" />
            </Link>

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
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl border border-border shadow-lg py-2 z-50">
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
                    {role === "admin" && (
                      <Link
                        to="/admin"
                        className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors"
                      >
                        <Settings className="w-5 h-5 text-google-blue" />
                        <span>Admin Dashboard</span>
                      </Link>
                    )}
                    <Link
                      to="/app/profile"
                      onClick={() => setShowUserMenu(false)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-text-primary hover:bg-gray-50 transition-colors"
                    >
                      <User className="w-5 h-5 text-text-secondary" />
                      <span>Profile</span>
                    </Link>
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
          {/* Left Sidebar */}
          <aside className="hidden lg:block w-80">
            {/* Credits Card */}
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-google-yellow/20 flex items-center justify-center">
                  <span className="text-2xl">🪙</span>
                </div>
                <div>
                  <p className="text-3xl font-medium text-text-primary">
                    {credits}
                  </p>
                  <p className="text-sm text-text-secondary">
                    Total credits earned
                  </p>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Chat Area */}
          <div className="flex-1 max-w-3xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
