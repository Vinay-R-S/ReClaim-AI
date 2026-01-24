import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Camera,
  Bell,
  Shield,
  Sparkles,
  ArrowRight,
  Zap,
  Menu,
  X,
} from "lucide-react";

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header - White background */}
      <header className="bg-white border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6 text-text-primary" />
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2">
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
          </div>

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
          </div>
        </div>
      </header>

      {/* Mobile Slide-out Drawer */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 md:hidden animate-fade-in"
            onClick={() => setMobileMenuOpen(false)}
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
                <span className="font-medium text-xl text-text-primary">
                  ReClaim AI
                </span>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
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
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                How it Works
              </a>
              <a
                href="#about"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-primary hover:bg-gray-100 font-medium transition-colors"
              >
                About
              </a>
            </nav>

            {/* Auth Buttons */}
            <div className="p-4 border-t border-border space-y-3">
              <Link
                to="/auth"
                onClick={() => setMobileMenuOpen(false)}
                className="block w-full py-3 text-center rounded-xl border border-border text-text-primary font-medium hover:bg-gray-50 transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/auth?mode=signup"
                onClick={() => setMobileMenuOpen(false)}
                className="block w-full py-3 text-center rounded-xl bg-primary text-white font-medium hover:bg-primary-hover transition-colors"
              >
                Get Started
              </Link>
            </div>
          </div>
        </>
      )}

      {/* Hero Section */}
      <section className="py-12 sm:py-20 lg:py-32 bg-gradient-to-b from-primary-light to-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-surface rounded-full px-4 py-2 mb-6 border border-border">
              <Sparkles className="w-4 h-4 text-google-yellow" />
              <span className="text-sm text-text-secondary">
                Powered by Google Gemini AI
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-6xl font-medium text-text-primary mb-4 sm:mb-6 leading-tight">
              Reunite with Your
              <span className="text-primary"> Lost Items</span>
            </h1>

            <p className="text-base sm:text-lg lg:text-xl text-text-secondary mb-6 sm:mb-8 max-w-2xl mx-auto px-4">
              ReClaim AI uses advanced image recognition and natural language
              understanding to match lost items with found reports. Finding what
              you've lost has never been easier.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center px-4">
              <Link
                to="/auth?mode=signup"
                className="btn-pill btn-primary text-base sm:text-lg px-6 sm:px-8 py-3 inline-flex items-center justify-center gap-2"
              >
                Report Lost Item
                <Search className="w-5 h-5" />
              </Link>
              <Link
                to="/auth?mode=signup"
                className="btn-pill btn-secondary text-base sm:text-lg px-6 sm:px-8 py-3 inline-flex items-center justify-center gap-2"
              >
                Report Found Item
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-8 sm:py-12 bg-surface border-y border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8 text-center">
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-primary">
                95%
              </p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">
                Match Accuracy
              </p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-green">
                10K+
              </p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">
                Items Reunited
              </p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-yellow">
                24hrs
              </p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">
                Avg. Match Time
              </p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-red">
                50+
              </p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">
                Collection Points
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-12 sm:py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-medium text-text-primary mb-3 sm:mb-4">
              Why Choose ReClaim AI?
            </h2>
            <p className="text-base sm:text-lg text-text-secondary max-w-2xl mx-auto">
              Our AI-powered platform makes finding lost items faster and more
              accurate than ever
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <FeatureCard
              icon={<Camera className="w-6 h-6" />}
              iconBg="bg-google-blue"
              title="Image Recognition"
              description="Upload a photo and our AI will analyze visual features to find matches"
            />
            <FeatureCard
              icon={<Sparkles className="w-6 h-6" />}
              iconBg="bg-google-yellow"
              title="Smart Matching"
              description="Natural language understanding matches descriptions intelligently"
            />
            <FeatureCard
              icon={<Bell className="w-6 h-6" />}
              iconBg="bg-google-green"
              title="Instant Alerts"
              description="Get notified immediately when a potential match is found"
            />
            <FeatureCard
              icon={<Shield className="w-6 h-6" />}
              iconBg="bg-google-red"
              title="Secure Handover"
              description="Verified collection points ensure safe item retrieval"
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-12 sm:py-20 bg-surface">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-medium text-text-primary mb-3 sm:mb-4">
              How It Works
            </h2>
            <p className="text-base sm:text-lg text-text-secondary max-w-2xl mx-auto">
              Three simple steps to reunite with your belongings
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6 sm:gap-8">
            <StepCard
              number="1"
              title="Report Your Item"
              description="Describe your lost or found item using text, photos, or voice. Our AI assistant will guide you through the process."
            />
            <StepCard
              number="2"
              title="AI Matches Items"
              description="Our Gemini-powered AI analyzes images and descriptions to find potential matches across all reports."
            />
            <StepCard
              number="3"
              title="Secure Retrieval"
              description="Once matched, coordinate pickup at a verified collection point and earn credits for your good deed."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-12 sm:py-20 bg-white border-y border-border">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-medium text-text-primary mb-3 sm:mb-4">
            Ready to Find Your Lost Items?
          </h2>
          <p className="text-base sm:text-lg text-text-secondary mb-6 sm:mb-8 max-w-2xl mx-auto">
            Join thousands of users who have successfully reunited with their
            belongings using ReClaim AI
          </p>
          <Link
            to="/auth?mode=signup"
            className="inline-flex items-center gap-2 bg-primary text-white font-medium px-6 sm:px-8 py-3 rounded-full hover:bg-primary-hover transition-colors"
          >
            Get Started for Free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface border-t border-border py-8 sm:py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-8 mb-8 sm:mb-12">
            {/* Logo and Description */}
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="/Logo.webp"
                  alt="ReClaim AI Logo"
                  width={40}
                  height={40}
                  loading="lazy"
                  className="w-10 h-10 object-contain rounded-full"
                />
                <span className="font-medium text-xl text-text-primary">
                  ReClaim AI
                </span>
              </div>
              <p className="text-text-secondary max-w-md text-sm sm:text-base">
                AI-powered lost and found platform that uses image recognition
                and natural language understanding to reunite people with their
                belongings.
              </p>
              <div className="flex items-center gap-2 mt-4 text-sm text-text-secondary">
                <Zap className="w-4 h-4 text-google-yellow" />
                Powered by Google Gemini
              </div>
            </div>

            {/* Links */}
            <div>
              <h4 className="font-medium text-text-primary mb-4">Product</h4>
              <ul className="space-y-2">
                <li>
                  <a
                    href="#features"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#how-it-works"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    How it Works
                  </a>
                </li>
                <li>
                  <Link
                    to="/auth"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    Sign In
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-text-primary mb-4">Legal</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    to="/under-construction"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    to="/under-construction"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    to="/under-construction"
                    className="text-text-secondary hover:text-primary transition-colors text-sm sm:text-base"
                  >
                    Help Center
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Big Title - Responsive */}
          <div className="text-center mb-8 sm:mb-12">
            <h1 className="text-[15vw] sm:text-[12vw] leading-none font-bold text-text-primary tracking-tight">
              ReClaim AI
            </h1>
          </div>

          {/* Bottom Footer */}
          <div className="pt-6 sm:pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs sm:text-sm text-text-secondary text-center sm:text-left">
              © {new Date().getFullYear()} ReClaim AI. Built for GDG Hackathon.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm text-text-secondary">
                Made with love using Google Cloud
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Feature Card Component
interface FeatureCardProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
}

function FeatureCard({ icon, iconBg, title, description }: FeatureCardProps) {
  return (
    <div className="card p-5 sm:p-6 hover:shadow-lg transition-shadow">
      <div
        className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${iconBg} text-white flex items-center justify-center mb-3 sm:mb-4`}
      >
        {icon}
      </div>
      <h3 className="font-medium text-text-primary mb-2 text-sm sm:text-base">
        {title}
      </h3>
      <p className="text-xs sm:text-sm text-text-secondary">{description}</p>
    </div>
  );
}

// Step Card Component
interface StepCardProps {
  number: string;
  title: string;
  description: string;
}

function StepCard({ number, title, description }: StepCardProps) {
  return (
    <div className="text-center">
      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-primary text-white text-xl sm:text-2xl font-medium flex items-center justify-center mx-auto mb-3 sm:mb-4">
        {number}
      </div>
      <h3 className="font-medium text-text-primary text-base sm:text-lg mb-2">
        {title}
      </h3>
      <p className="text-sm sm:text-base text-text-secondary">{description}</p>
    </div>
  );
}
