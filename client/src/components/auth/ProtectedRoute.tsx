import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, role, userStatus, loading } = useAuth();
  const location = useLocation();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          {/* Google-style loading spinner */}
          <div className="w-12 h-12 relative">
            <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
          </div>
          <p className="text-text-secondary text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to auth page if not authenticated
  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // HARD BLOCK: Check if user is blocked
  if (userStatus === "blocked") {
    // This should already be handled by AuthContext, but as a safety measure
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  // Redirect admin to admin dashboard
  if (role === "admin") {
    return <Navigate to="/admin" replace />;
  }

  // Render protected content
  return <>{children}</>;
}
