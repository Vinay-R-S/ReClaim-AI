// Firebase configuration and initialization
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";

// Firebase configuration
// Note: These are public keys safe to expose in client-side code
// Security is handled by Firebase Security Rules
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDgbBYNAJhSiIzPrenievyjlqoQ3M6HDN4",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "reclaim-ai-bc273.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "reclaim-ai-bc273",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "reclaim-ai-bc273.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "15651340362",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:15651340362:web:f3225c54b27cb8258526b3",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-YL3R3JRTYS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize Analytics only in browser environment
export const analytics = typeof window !== 'undefined' ? getAnalytics(app) : null;

export default app;
