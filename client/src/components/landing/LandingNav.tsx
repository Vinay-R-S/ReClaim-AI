/**
 * The landing page header and its mobile drawer.
 *
 * Half the page was this: a desktop bar, a slide-out drawer with the same
 * links again, and the auth buttons in both.
 */

import { Link } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface LandingNavProps {
  mobileMenuOpen: boolean;
  onOpenMobileMenu: () => void;
  onCloseMobileMenu: () => void;
  onSignOut: () => void;
}

export function LandingNav({
  mobileMenuOpen,
  onOpenMobileMenu,
  onCloseMobileMenu,
  onSignOut,
}: LandingNavProps) {
  const { user } = useAuth();
  return (
    <>
      {/* Header - White background */}
      <header className="bg-white border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Mobile Menu Button */}
          <button
            onClick={() => onOpenMobileMenu()}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6 text-text-primary" />
          </button>

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <img
              src="/Logo.webp"
              alt="ReClaim AI Logo"
              width={40}
              height={40}
              className="w-10 h-10 object-contain rounded-full"
            />
            <span className="font-medium text-xl text-text-primary">ReClaim AI</span>
          </Link>

          {/* Nav Links - Hidden on mobile */}
          <nav className="hidden md:flex items-center gap-6">
            <a
              href="#features"
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              How it Works
            </a>
            <a
              href="#about"
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              About
            </a>
          </nav>

          {/* Auth Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <>
                <Link to="/app" className="btn-pill btn-primary text-sm sm:text-base px-4 sm:px-6">
                  Go to App
                </Link>
                <button
                  onClick={onSignOut}
                  className="hidden sm:inline-flex items-center gap-2 text-google-red hover:text-red-700 font-medium transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  className="hidden sm:inline text-text-secondary hover:text-text-primary font-medium transition-colors"
                >
                  Sign In
                </Link>
                <Link
                  to="/auth?mode=signup"
                  className="btn-pill btn-primary text-sm sm:text-base px-4 sm:px-6"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Slide-out Drawer */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 md:hidden animate-fade-in"
            onClick={() => onCloseMobileMenu()}
          />

          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 w-80 max-w-[85vw] bg-white shadow-xl z-50 md:hidden flex flex-col animate-slide-in-left">
            {/* Drawer Header */}
            <div className="h-16 px-4 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-2">
                <img
                  src="/Logo.webp"
                  alt="ReClaim AI Logo"
                  width={40}
                  height={40}
                  className="w-10 h-10 object-contain rounded-full"
                />
                <span className="font-medium text-xl text-text-primary">ReClaim AI</span>
              </div>
              <button
                onClick={() => onCloseMobileMenu()}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Close menu"
              >
                <X className="w-6 h-6 text-text-secondary" />
              </button>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-4 py-6 space-y-2">
              <a
                href="#features"
                onClick={() => onCloseMobileMenu()}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={() => onCloseMobileMenu()}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                How it Works
              </a>
              <a
                href="#about"
                onClick={() => onCloseMobileMenu()}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                About
              </a>
            </nav>

            {/* Auth Buttons */}
            <div className="p-4 border-t border-border space-y-3">
              {user ? (
                <>
                  <Link
                    to="/app"
                    onClick={() => onCloseMobileMenu()}
                    className="block w-full py-3 text-center rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
                  >
                    Go to App
                  </Link>
                  <button
                    onClick={() => {
                      onSignOut();
                      onCloseMobileMenu();
                    }}
                    className="flex items-center justify-center gap-2 w-full py-3 text-center rounded-xl border border-red-200 text-google-red font-medium hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link
                    to="/auth"
                    onClick={() => onCloseMobileMenu()}
                    className="block w-full py-3 text-center rounded-xl border border-border text-text-primary font-medium hover:bg-gray-50 transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/auth?mode=signup"
                    onClick={() => onCloseMobileMenu()}
                    className="block w-full py-3 text-center rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
