/**
 * The landing page footer.
 */

import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';

export function LandingFooter() {
  return (
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
              <span className="font-medium text-xl text-text-primary">ReClaim AI</span>
            </div>
            <p className="text-text-secondary max-w-md text-sm sm:text-base">
              AI-powered lost and found platform that uses LLM-based semantic matching to reunite
              people with their belongings.
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
            © {new Date().getFullYear()} ReClaim AI. Built for GDG TechSprint Hackathon.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm text-text-secondary">
              Made with love using Google tech
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
