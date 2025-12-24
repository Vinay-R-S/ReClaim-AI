import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, HelpCircle, CameraIcon, MapPin, Send } from "lucide-react";
import { cn } from "../../lib/utils";

interface UserLayoutProps {
  children: React.ReactNode;
}

const navTabs = [
  { name: "Assistant", path: "/" },
  { name: "My Reports", path: "/reports" },
  { name: "Matches", path: "/matches" },
  { name: "Collection Points", path: "/collection-points" },
];

export function UserLayout({ children }: UserLayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar */}
      <header className="bg-surface border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-google-blue via-google-red to-google-yellow flex items-center justify-center">
              <span className="text-white font-bold text-lg">R</span>
            </div>
            <span className="font-medium text-xl text-text-primary">
              ReClaim AI
            </span>
          </div>

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
            <button className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
              JS
            </button>
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
