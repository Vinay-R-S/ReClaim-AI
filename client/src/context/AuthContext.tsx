import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  type User,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { authFetch } from '../lib/authApi';

interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  credits: number;
}

/**
 * Create or refresh the caller's profile document.
 *
 * The browser used to write `users/{uid}` itself, including `role`, `status`
 * and `credits`, so anyone could self-assign `role: "admin"` (defect SEC-17).
 * The Firestore rules now deny those fields to the client and the server owns
 * them. A 403 means the account is blocked.
 */
const loadProfile = async (user: User): Promise<UserProfile | 'blocked'> => {
  const response = await authFetch('/api/auth/profile', {
    method: 'POST',
    body: JSON.stringify({
      displayName: user.displayName ?? undefined,
      photoURL: user.photoURL ?? undefined,
    }),
  });

  if (response.status === 403) return 'blocked';

  if (!response.ok) {
    throw new Error('Failed to load user profile');
  }

  const data = (await response.json()) as { profile: UserProfile };
  return data.profile;
};

// Helper function to send login notification.
// The endpoint now derives the uid from the ID token, so nothing is sent in the body.
const sendLoginNotification = async () => {
  try {
    const response = await authFetch('/api/auth/login-notification', {
      method: 'POST',
      body: JSON.stringify({
        loginTime: new Date().toLocaleString(),
      }),
    });

    if (!response.ok) {
      console.error('Failed to send login notification');
    }
  } catch (error) {
    console.error('Error sending login notification:', error);
  }
};

// Types
interface AuthContextType {
  user: User | null;
  role: 'user' | 'admin' | null;
  userStatus: 'active' | 'blocked' | null;
  loading: boolean;
  error: string | null;
  blockedError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
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
  const [role, setRole] = useState<'user' | 'admin' | null>(null);
  const [userStatus, setUserStatus] = useState<'active' | 'blocked' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUser(user);
        await loadUserProfile(user);
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

  // Resolve the signed-in user's role and status
  const loadUserProfile = async (currentUser: User) => {
    try {
      const profile = await loadProfile(currentUser);

      if (profile === 'blocked') {
        setBlockedError('Your account has been blocked due to policy violations.');
        await firebaseSignOut(auth);
        setUser(null);
        setRole(null);
        setUserStatus(null);
        return;
      }

      setRole(profile.role);
      setUserStatus(profile.status);
    } catch (err) {
      console.error('Error loading user profile:', err);
      // Leave role and status unresolved rather than asserting an active user:
      // the server is the authority and refuses a blocked account on every
      // endpoint, so claiming 'active' here would only be a false UI signal.
      setRole(null);
      setUserStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // Sign in with Google
  const signInWithGoogle = async () => {
    try {
      setError(null);
      setLoading(true);
      const result = await signInWithPopup(auth, googleProvider);

      if (result.user) {
        // Google sign-in is also the signup path, so make sure the profile
        // exists before calling an endpoint that requires one.
        await loadUserProfile(result.user);
        await sendLoginNotification();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to sign in with Google');
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
        await sendLoginNotification();
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
  const signUpWithEmail = async (email: string, password: string, displayName?: string) => {
    try {
      setError(null);
      setLoading(true);
      const result = await createUserWithEmailAndPassword(auth, email, password);

      if (displayName && result.user) {
        // Update Firebase Auth profile with displayName
        await updateProfile(result.user, { displayName });

        // onAuthStateChanged may have already created the profile from a user
        // object that had no displayName yet, so send it explicitly. The
        // endpoint is idempotent and fills the name in if it is still blank.
        await loadUserProfile(result.user);
      }

      if (result.user) {
        await sendLoginNotification();
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
      setError(err.message || 'Failed to sign out');
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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Helper function to get user-friendly error messages
function getAuthErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed. Please try again.';
    default:
      return 'An error occurred. Please try again.';
  }
}
