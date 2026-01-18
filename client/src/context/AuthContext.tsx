import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  type User,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, db } from "../lib/firebase";

// Helper function to send login notification
const sendLoginNotification = async (userId: string) => {
  try {
    console.log("Attempting to send login notification for user:", userId);
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

    const response = await fetch(`${API_URL}/api/auth/login-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        loginTime: new Date().toLocaleString(),
      }),
    });

    const result = await response.json();
    console.log("Login notification response:", result);

    if (!response.ok) {
      console.error("Failed to send login notification:", result);
    } else {
      console.log("Login notification sent successfully:", result);
    }
  } catch (error) {
    console.error("Error sending login notification:", error);
  }
};

// Types
interface AuthContextType {
  user: User | null;
  role: "user" | "admin" | null;
  userStatus: "active" | "blocked" | null;
  loading: boolean;
  error: string | null;
  blockedError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  clearError: () => void;
  clearBlockedError: () => void;
}

interface AuthProviderProps {
  children: ReactNode;
}

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Provider component
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"user" | "admin" | null>(null);
  const [userStatus, setUserStatus] = useState<"active" | "blocked" | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        // Fetch user role from Firestore
        await fetchUserRole(user.uid);
      } else {
        setUser(null);
        setRole(null);
        setUserStatus(null);
        setBlockedError(null); // Clear blocked error on sign out
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch user role and status
  const fetchUserRole = async (uid: string) => {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const status = userData.status || "active";
        setRole(userData.role || "user");
        setUserStatus(status);

        // Check if user is blocked - HARD BLOCK
        if (status === "blocked") {
          setBlockedError(
            "Your account has been blocked due to policy violations.",
          );
          // Immediately sign out the blocked user
          await firebaseSignOut(auth);
          setUser(null);
          setRole(null);
          setUserStatus(null);
          setLoading(false);
          return;
        }

        // Update last login only for active users
        await setDoc(
          doc(db, "users", uid),
          { lastLoginAt: serverTimestamp() },
          { merge: true },
        );
      } else {
        // New user - handled by saveUserToFirestore
        await saveUserToFirestore(auth.currentUser!);
        setUserStatus("active"); // New users are active by default
      }
    } catch (err) {
      console.error("Error fetching user role:", err);
      setRole("user"); // Default to user on error
      setUserStatus("active"); // Default to active on error
    } finally {
      setLoading(false);
    }
  };

  // Save user data to Firestore
  const saveUserToFirestore = async (user: User) => {
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // New user - create document with default 'user' role AND credits
        const newUser = {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          role: "user",
          status: "active",
          credits: 10, // ✨ Initialize with 10 credits
          lostItemsCount: 0, // ✨ Initialize counts
          foundItemsCount: 0,
          totalItemsCount: 0,
          createdAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        };
        await setDoc(userRef, newUser);
        setRole("user");

        // ✨ Log credit transaction in backend
        const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
        try {
          await fetch(`${API_URL}/api/credits/signup-bonus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: user.uid }),
          });
        } catch (err) {
          console.error("Failed to log signup bonus:", err);
        }
      } else {
        // Existing user - update last login
        await setDoc(
          userRef,
          {
            lastLoginAt: serverTimestamp(),
          },
          { merge: true },
        );
        // Role is set in fetchUserRole
      }
    } catch (err) {
      console.error("Error saving user to Firestore:", err);
    }
  };

  // Sign in with Google
  const signInWithGoogle = async () => {
    try {
      setError(null);
      setLoading(true);
      await signInWithPopup(auth, googleProvider).then(async (result) => {
        if (result.user) {
          await sendLoginNotification(result.user.uid);
        }
      });
    } catch (err: any) {
      setError(err.message || "Failed to sign in with Google");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Sign in with email and password
  const signInWithEmail = async (email: string, password: string) => {
    try {
      setError(null);
      setLoading(true);
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (result.user) {
        await sendLoginNotification(result.user.uid);
      }
    } catch (err: any) {
      const errorMessage = getAuthErrorMessage(err.code);
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Sign up with email and password
  const signUpWithEmail = async (
    email: string,
    password: string,
    displayName?: string,
  ) => {
    try {
      setError(null);
      setLoading(true);
      const result = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );

      if (displayName && result.user) {
        // Update Firebase Auth profile with displayName
        await updateProfile(result.user, { displayName });

        // Also update Firestore directly with the displayName
        // (since onAuthStateChanged might fire before updateProfile completes)
        const userRef = doc(db, "users", result.user.uid);
        await setDoc(
          userRef,
          {
            uid: result.user.uid,
            email: result.user.email,
            displayName: displayName,
            photoURL: result.user.photoURL,
            role: "user",
            status: "active",
            credits: 10, // ✨ Initialize with 10 credits
            lostItemsCount: 0, // ✨ Initialize counts
            foundItemsCount: 0,
            totalItemsCount: 0,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          },
          { merge: true },
        );

        // ✨ Log credit transaction
        const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
        try {
          await fetch(`${API_URL}/api/credits/signup-bonus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: result.user.uid }),
          });
        } catch (err) {
          console.error("Failed to log signup bonus:", err);
        }
      }

      if (result.user) {
        await sendLoginNotification(result.user.uid);
      }
    } catch (err: any) {
      const errorMessage = getAuthErrorMessage(err.code);
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Sign out
  const signOut = async () => {
    try {
      setError(null);
      await firebaseSignOut(auth);
    } catch (err: any) {
      setError(err.message || "Failed to sign out");
      throw err;
    }
  };

  // Reset password - sends password reset email via Firebase
  const resetPassword = async (email: string) => {
    try {
      setError(null);
      await sendPasswordResetEmail(auth, email);
    } catch (err: any) {
      const errorMessage = getAuthErrorMessage(err.code);
      setError(errorMessage);
      throw err;
    }
  };

  // Clear error
  const clearError = () => setError(null);
  const clearBlockedError = () => setBlockedError(null);

  const value: AuthContextType = {
    user,
    role,
    userStatus,
    loading,
    error,
    blockedError,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    resetPassword,
    clearError,
    clearBlockedError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Helper function to get user-friendly error messages
function getAuthErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "auth/email-already-in-use":
      return "This email is already registered. Please sign in instead.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
      return "No account found with this email.";
    case "auth/wrong-password":
      return "Incorrect password. Please try again.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Please try again later.";
    case "auth/popup-closed-by-user":
      return "Sign-in popup was closed. Please try again.";
    default:
      return "An error occurred. Please try again.";
  }
}
