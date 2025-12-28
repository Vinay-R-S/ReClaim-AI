import { Link } from "react-router-dom";
import {
  Search,
  Camera,
  Bell,
  Shield,
  Sparkles,
  ArrowRight,
  Zap,
} from "lucide-react";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="glass sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img
              src="/Logo.png"
              alt="ReClaim AI Logo"
              className="w-10 h-10 object-contain rounded-full"
            />
            <span className="font-medium text-xl text-text-primary">
              ReClaim AI
            </span>
          </div>

          {/* Nav Links */}
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
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="text-text-secondary hover:text-text-primary font-medium transition-colors"
            >
              Sign In
            </Link>
            <Link to="/auth?mode=signup" className="btn-pill btn-primary">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 lg:py-32 bg-gradient-to-b from-primary-light to-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-surface rounded-full px-4 py-2 mb-6 border border-border">
              <Sparkles className="w-4 h-4 text-google-yellow" />
              <span className="text-sm text-text-secondary">
                Powered by Google Gemini AI
              </span>
            </div>

            <h1 className="text-4xl lg:text-6xl font-medium text-text-primary mb-6 leading-tight">
              Reunite with Your
              <span className="text-primary"> Lost Items</span>
            </h1>

            <p className="text-lg lg:text-xl text-text-secondary mb-8 max-w-2xl mx-auto">
              ReClaim AI uses advanced image recognition and natural language
              understanding to match lost items with found reports. Finding what
              you've lost has never been easier.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/auth?mode=signup"
                className="btn-pill btn-primary text-lg px-8 py-3 inline-flex items-center justify-center gap-2"
              >
                Report Lost Item
                <Search className="w-5 h-5" />
              </Link>
              <Link
                to="/auth?mode=signup"
                className="btn-pill btn-secondary text-lg px-8 py-3 inline-flex items-center justify-center gap-2"
              >
                Report Found Item
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 bg-surface border-y border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <p className="text-3xl lg:text-4xl font-medium text-primary">
                95%
              </p>
              <p className="text-text-secondary mt-1">Match Accuracy</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-medium text-google-green">
                10K+
              </p>
              <p className="text-text-secondary mt-1">Items Reunited</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-medium text-google-yellow">
                24hrs
              </p>
              <p className="text-text-secondary mt-1">Avg. Match Time</p>
            </div>
            <div>
              <p className="text-3xl lg:text-4xl font-medium text-google-red">
                50+
              </p>
              <p className="text-text-secondary mt-1">Collection Points</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-medium text-text-primary mb-4">
              Why Choose ReClaim AI?
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              Our AI-powered platform makes finding lost items faster and more
              accurate than ever
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
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
      <section id="how-it-works" className="py-20 bg-surface">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-medium text-text-primary mb-4">
              How It Works
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              Three simple steps to reunite with your belongings
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
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
      <section className="py-20 bg-white border-y border-border">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl lg:text-4xl font-medium text-text-primary mb-4">
            Ready to Find Your Lost Items?
          </h2>
          <p className="text-lg text-text-secondary mb-8 max-w-2xl mx-auto">
            Join thousands of users who have successfully reunited with their
            belongings using ReClaim AI
          </p>
          <Link
            to="/auth?mode=signup"
            className="inline-flex items-center gap-2 bg-primary text-white font-medium px-8 py-3 rounded-full hover:bg-primary-hover transition-colors"
          >
            Get Started for Free
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-surface border-t border-border py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            {/* Logo and Description */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <img
                  src="/Logo.png"
                  alt="ReClaim AI Logo"
                  className="w-10 h-10 object-contain rounded-full"
                />
                <span className="font-medium text-xl text-text-primary">
                  ReClaim AI
                </span>
              </div>
              <p className="text-text-secondary max-w-md">
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
                    className="text-text-secondary hover:text-primary transition-colors"
                  >
                    Features
                  </a>
                </li>
                <li>
                  <a
                    href="#how-it-works"
                    className="text-text-secondary hover:text-primary transition-colors"
                  >
                    How it Works
                  </a>
                </li>
                <li>
                  <Link
                    to="/auth"
                    className="text-text-secondary hover:text-primary transition-colors"
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
                    className="text-text-secondary hover:text-primary transition-colors"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    to="/under-construction"
                    className="text-text-secondary hover:text-primary transition-colors"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    to="/under-construction"
                    className="text-text-secondary hover:text-primary transition-colors"
                  >
                    Help Center
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Big Title */}
          <div className="text-center mb-12">
            <h1 className="text-[12vw] leading-none font-bold text-text-primary tracking-tight">
              ReClaim AI
            </h1>
          </div>

          {/* Bottom Footer */}
          <div className="pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-text-secondary">
              © {new Date().getFullYear()} ReClaim AI. Built for GDG Hackathon.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-secondary">
                Made with ❤️ using Google Cloud
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
    <div className="card p-6 hover:shadow-lg transition-shadow">
      <div
        className={`w-12 h-12 rounded-xl ${iconBg} text-white flex items-center justify-center mb-4`}
      >
        {icon}
      </div>
      <h3 className="font-medium text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary">{description}</p>
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
      <div className="w-16 h-16 rounded-full bg-primary text-white text-2xl font-medium flex items-center justify-center mx-auto mb-4">
        {number}
      </div>
      <h3 className="font-medium text-text-primary text-lg mb-2">{title}</h3>
      <p className="text-text-secondary">{description}</p>
    </div>
  );
}
