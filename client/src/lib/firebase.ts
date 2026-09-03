// Firebase configuration and initialization
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

// The web config is public by design: access is controlled by the Firestore
// rules and by the authorized-domain allowlist, not by hiding these values.
// They are still required rather than hardcoded, so a build cannot silently
// point a fork of this app at the production project (defect SEC-21).
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy client/.env.example to client/.env and fill in the Firebase web config.`,
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: required(
    'VITE_FIREBASE_STORAGE_BUCKET',
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  ),
  messagingSenderId: required(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: required('VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID),
  // Analytics is optional; without it getAnalytics is simply skipped.
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize Analytics only in browser environment
export const analytics =
  typeof window !== 'undefined' && firebaseConfig.measurementId ? getAnalytics(app) : null;

export default app;
