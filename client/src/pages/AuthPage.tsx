import { useState, useEffect } from "react";
import {
  Link,
  useNavigate,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function AuthPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    error,
    blockedError,
    clearError,
    clearBlockedError,
  } = useAuth();

  const [isSignUp, setIsSignUp] = useState(
    searchParams.get("mode") === "signup",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    displayName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Clear blocked error on mount
  useEffect(() => {
    clearBlockedError();
  }, [clearBlockedError]);

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || "/app";
      navigate(from, { replace: true });
    }
  }, [user, navigate, location]);

  // Clear errors when switching modes
  useEffect(() => {
    clearError();
    setFormError(null);
  }, [isSignUp]);

  // Update mode based on URL
  useEffect(() => {
    setIsSignUp(searchParams.get("mode") === "signup");
  }, [searchParams]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setFormError(null);
  };

  const validateForm = (): boolean => {
    if (!formData.email || !formData.password) {
      setFormError("Please fill in all required fields");
      return false;
    }

    if (isSignUp) {
      if (formData.password !== formData.confirmPassword) {
        setFormError("Passwords do not match");
        return false;
      }
      if (formData.password.length < 6) {
        setFormError("Password must be at least 6 characters");
        return false;
      }
    }

    return true;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(
          formData.email,
          formData.password,
          formData.displayName,
        );
      } else {
        await signInWithEmail(formData.email, formData.password);
      }
    } catch (err) {
      // Error is handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      // Error is handled by context
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left side - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mb-8">
            <img
              src="/Logo.webp"
              alt="ReClaim AI Logo"
              className="w-10 h-10 object-contain rounded-full"
            />
            <span className="font-medium text-xl text-text-primary">
              ReClaim AI
            </span>
          </Link>

          {/* Header */}
          <h1 className="text-2xl lg:text-3xl font-medium text-text-primary mb-2">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-text-secondary mb-8">
            {isSignUp
              ? "Start finding your lost items with AI"
              : "Sign in to continue to ReClaim AI"}
          </p>

          {/* Google Sign In Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="font-medium text-text-primary">
                  Continue with Google
                </span>
              </>
            )}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-sm text-text-secondary">
              or continue with email
            </span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          {/* Blocked User Error Message */}
          {blockedError && (
            <div className="mb-4 p-4 bg-red-50 border-2 border-red-300 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-google-red flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-base font-medium text-google-red mb-1">
                  Account Blocked
                </p>
                <p className="text-sm text-google-red">{blockedError}</p>
              </div>
            </div>
          )}

          {/* Regular Error Message */}
          {(error || formError) && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-google-red flex-shrink-0 mt-0.5" />
              <p className="text-sm text-google-red">{error || formError}</p>
            </div>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isSignUp && (
              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium text-text-primary mb-1"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                  <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    placeholder="John Doe"
                    className="w-full pl-10 pr-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-text-primary mb-1"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-10 pr-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text-primary mb-1"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder="••••••••"
                  required
                  className="w-full pl-10 pr-12 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-text-primary mb-1"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary" />
                  <input
                    type={showPassword ? "text" : "password"}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    placeholder="••••••••"
                    required
                    className="w-full pl-10 pr-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full btn-pill btn-primary py-3 text-center disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>
                    {isSignUp ? "Creating account..." : "Signing in..."}
                  </span>
                </>
              ) : (
                <span>{isSignUp ? "Create Account" : "Sign In"}</span>
              )}
            </button>
          </form>

          {/* Toggle Sign In/Up */}
          <p className="mt-6 text-center text-text-secondary">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-primary font-medium hover:underline"
            >
              {isSignUp ? "Sign in" : "Sign up"}
            </button>
          </p>
        </div>
      </div>

      {/* Right side - Illustration */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-white via-primary-light to-blue-50 items-center justify-center p-12">
        <div className="max-w-lg text-center">
          <div className="w-24 h-24 rounded-2xl bg-white shadow-lg flex items-center justify-center mx-auto mb-8">
            <span className="text-5xl">🔍</span>
          </div>
          <h2 className="text-3xl font-medium mb-4 text-text-primary">
            Lost Something?
          </h2>
          <p className="text-lg text-text-secondary">
            Our AI-powered platform uses image recognition and natural language
            understanding to help you find your lost items quickly and
            efficiently.
          </p>
          <div className="mt-8 flex items-center justify-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-medium text-primary">95%</p>
              <p className="text-sm text-text-secondary">Match Accuracy</p>
            </div>
            <div className="w-px h-12 bg-border"></div>
            <div className="text-center">
              <p className="text-2xl font-medium text-google-yellow">24hrs</p>
              <p className="text-sm text-text-secondary">Avg. Match Time</p>
            </div>
            <div className="w-px h-12 bg-border"></div>
            <div className="text-center">
              <p className="text-2xl font-medium text-google-green">10K+</p>
              <p className="text-sm text-text-secondary">Items Found</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
