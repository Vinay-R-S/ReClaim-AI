import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LandingNav } from '../components/landing/LandingNav';
import { LandingFooter } from '../components/landing/LandingFooter';
import { FeatureCard, StepCard } from '../components/landing/LandingCards';
import { ArrowRight, Bell, Camera, Search, Shield, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  return (
    <div className="min-h-screen bg-background">
      <LandingNav
        mobileMenuOpen={mobileMenuOpen}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
        onSignOut={handleSignOut}
      />

      {/* Hero Section */}
      <section className="py-12 sm:py-20 lg:py-32 bg-gradient-to-b from-primary-light to-background">
        <div className="max-w-7xl mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-surface rounded-full px-4 py-2 mb-6 border border-border">
              <Sparkles className="w-4 h-4 text-google-yellow" />
              <span className="text-sm text-text-secondary">Powered by Google Gemini AI</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-6xl font-medium text-text-primary mb-4 sm:mb-6 leading-tight">
              Reunite with Your
              <span className="text-primary"> Lost Items</span>
            </h1>

            <p className="text-base sm:text-lg lg:text-xl text-text-secondary mb-6 sm:mb-8 max-w-2xl mx-auto px-4">
              ReClaim AI uses LLM-based semantic matching and visual similarity to intelligently
              match lost items with found reports. Finding what you've lost has never been easier.
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
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-primary">95%</p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">Match Accuracy</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-green">10K+</p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">Items Reunited</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-yellow">
                24hrs
              </p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">Avg. Match Time</p>
            </div>
            <div>
              <p className="text-2xl sm:text-3xl lg:text-4xl font-medium text-google-red">50+</p>
              <p className="text-sm sm:text-base text-text-secondary mt-1">Collection Points</p>
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
              Combining LLM semantic understanding with visual similarity for unmatched accuracy in
              item matching
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            <FeatureCard
              icon={<Camera className="w-6 h-6" />}
              iconBg="bg-google-blue"
              title="Visual Similarity"
              description="Clarifai-powered image analysis finds visually similar items across all reports"
            />
            <FeatureCard
              icon={<Sparkles className="w-6 h-6" />}
              iconBg="bg-google-yellow"
              title="LLM Semantic Matching"
              description="Gemini AI understands context and meaning to match item descriptions intelligently"
            />
            <FeatureCard
              icon={<Bell className="w-6 h-6" />}
              iconBg="bg-google-green"
              title="Email & OTP Verification"
              description="Secure handover process with email notifications and OTP verification for safe item collection"
            />
            <FeatureCard
              icon={<Shield className="w-6 h-6" />}
              iconBg="bg-google-red"
              title="Blockchain Verified"
              description="Ethereum-based handover verification for tamper-proof records"
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
              description="Submit your lost or found item with photos, description, location, and time. Our smart form captures all the details needed for matching."
            />
            <StepCard
              number="2"
              title="Dual AI Matching"
              description="Gemini LLM analyzes descriptions semantically while Clarifai compares images visually - double the matching power."
            />
            <StepCard
              number="3"
              title="Blockchain Verified Handover"
              description="Collect your item at a verified point. Each handover is recorded on Ethereum for tamper-proof verification."
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
            Join thousands of users who have successfully reunited with their belongings using
            ReClaim AI
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

      <LandingFooter />
    </div>
  );
}
