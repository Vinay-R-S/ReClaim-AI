/**
 * Welcome Page - Google-themed disclaimer page for Testing mode
 * Shows rate limits, hosting info, and development status before users access the main app
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Zap,
  Server,
  Code,
  ArrowRight,
  Loader2,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function WelcomePage() {
  const [isLoading, setIsLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    // Check if user has already seen the welcome page
    const hasSeenWelcome = localStorage.getItem("hasSeenWelcome");

    // Check if testing mode is enabled
    const checkMode = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/settings/mode`);
        const data = await response.json();

        // If not in testing mode or already seen, skip to landing
        if (!data.testingMode || hasSeenWelcome) {
          navigate("/", { replace: true });
          return;
        }

        // Track the visit
        await fetch(`${API_BASE_URL}/api/settings/visit`, { method: "POST" });

        setIsLoading(false);
      } catch (error) {
        console.error("Failed to check mode:", error);
        navigate("/", { replace: true });
      }
    };

    checkMode();
  }, [navigate]);

  const handleContinue = () => {
    localStorage.setItem("hasSeenWelcome", "true");
    navigate("/");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#4285F4]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="p-6 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <img
            src="/Logo.webp"
            alt="ReClaim AI Logo"
            className="w-12 h-12 rounded-full"
          />
          <span className="text-2xl font-medium text-gray-800">ReClaim AI</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="max-w-2xl w-full text-center space-y-8">
          {/* Google-colored welcome */}
          <h1 className="text-4xl md:text-5xl font-medium">
            <span className="text-[#4285F4]">W</span>
            <span className="text-[#EA4335]">e</span>
            <span className="text-[#FBBC05]">l</span>
            <span className="text-[#4285F4]">c</span>
            <span className="text-[#34A853]">o</span>
            <span className="text-[#EA4335]">m</span>
            <span className="text-[#4285F4]">e</span>
          </h1>

          <p className="text-lg text-gray-600">
            Thanks for checking out ReClaim AI! Please note the following before
            you proceed:
          </p>

          {/* Info Cards */}
          <div className="grid md:grid-cols-3 gap-4 text-left">
            {/* Rate Limit Card */}
            <div className="bg-[#E8F0FE] rounded-xl p-5 border border-[#4285F4]/20">
              <div className="w-10 h-10 rounded-lg bg-[#4285F4] flex items-center justify-center mb-3">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-medium text-gray-800 mb-2">Rate Limited</h3>
              <p className="text-sm text-gray-600">
                <span className="font-semibold text-[#4285F4]">
                  400 API calls/day
                </span>{" "}
                limit is active to manage server costs during testing.
              </p>
            </div>

            {/* Hosting Card */}
            <div className="bg-[#FCE8E6] rounded-xl p-5 border border-[#EA4335]/20">
              <div className="w-10 h-10 rounded-lg bg-[#EA4335] flex items-center justify-center mb-3">
                <Server className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-medium text-gray-800 mb-2">Free Hosting</h3>
              <p className="text-sm text-gray-600">
                Running on <span className="font-semibold">Vercel</span> +{" "}
                <span className="font-semibold">Render</span>. Backend may take
                30-60s to wake from sleep.
              </p>
            </div>

            {/* Development Card */}
            <div className="bg-[#E6F4EA] rounded-xl p-5 border border-[#34A853]/20">
              <div className="w-10 h-10 rounded-lg bg-[#34A853] flex items-center justify-center mb-3">
                <Code className="w-5 h-5 text-white" />
              </div>
              <h3 className="font-medium text-gray-800 mb-2">In Development</h3>
              <p className="text-sm text-gray-600">
                Some features may not work perfectly. We're actively improving
                the app.
              </p>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-center justify-center gap-2 text-amber-600 bg-amber-50 rounded-lg py-3 px-4">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">
              If you see a 404 or loading error, the backend is warming up.
              Please wait and refresh.
            </span>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-8 py-3 bg-[#4285F4] hover:bg-[#3367D6] text-white font-medium rounded-full transition-all hover:shadow-lg transform hover:scale-[1.02]"
          >
            Continue to ReClaim AI
            <ArrowRight className="w-5 h-5" />
          </button>

          <p className="text-xs text-gray-400">
            Built for GDG Hackathon • Powered by Google Gemini
          </p>
        </div>
      </main>
    </div>
  );
}

export default WelcomePage;
