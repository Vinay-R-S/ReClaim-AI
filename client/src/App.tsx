import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Suspense, lazy } from "react";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AdminRoute } from "./components/auth/AdminRoute";
import "./index.css";

// Lazy load page components for better code splitting
const LandingPage = lazy(() =>
  import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const AuthPage = lazy(() =>
  import("./pages/AuthPage").then((m) => ({ default: m.AuthPage })),
);
const HomePage = lazy(() =>
  import("./pages/user/HomePage").then((m) => ({ default: m.HomePage })),
);
const MyReportsPage = lazy(() =>
  import("./pages/user/MyReportsPage").then((m) => ({
    default: m.MyReportsPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./pages/user/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);
const HowItWorksPage = lazy(() =>
  import("./pages/user/HowItWorksPage").then((m) => ({
    default: m.HowItWorksPage,
  })),
);
const HandoversPage = lazy(() =>
  import("./pages/user/HandoversPage").then((m) => ({
    default: m.HandoversPage,
  })),
);
const AdminPage = lazy(() =>
  import("./pages/admin/AdminPage").then((m) => ({ default: m.AdminPage })),
);
const UnderConstruction = lazy(() =>
  import("./pages/UnderConstruction").then((m) => ({
    default: m.UnderConstruction,
  })),
);
const VerifyHandoverPage = lazy(() => import("./pages/VerifyHandoverPage"));

// Loading fallback component
function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-text-secondary text-sm">Loading...</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/verify/:matchId"
              element={<VerifyHandoverPage />}
            />{" "}
            {/* [NEW] */}
            <Route path="/under-construction" element={<UnderConstruction />} />
            {/* Protected User Routes */}
            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/reports"
              element={
                <ProtectedRoute>
                  <MyReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/how-it-works"
              element={
                <ProtectedRoute>
                  <HowItWorksPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/handovers"
              element={
                <ProtectedRoute>
                  <HandoversPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/app/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            {/* Protected Admin Routes */}
            <Route
              path="/admin/*"
              element={
                <AdminRoute>
                  <AdminPage />
                </AdminRoute>
              }
            />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
