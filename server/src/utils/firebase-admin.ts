import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createLogger } from './logger.js';
import { env } from '../config/env.js';

const log = createLogger('firebase-admin');

// Initialize Firebase Admin SDK
// For local development, use service account JSON
// For production (Vercel), use environment variables

let app: admin.app.App;

if (!admin.apps.length) {
  // Check if we have a service account key in env
  const serviceAccountBase64 = env.firebase.serviceAccountKey;

  if (serviceAccountBase64) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(serviceAccountBase64, 'base64').toString('utf-8'),
      );

      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } catch (error) {
      log.error('Error parsing Firebase service account:', error);
      throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_KEY');
    }
  } else {
    // Fallback: Use application default credentials (for local dev with gcloud CLI)
    app = admin.initializeApp({
      projectId: env.firebase.projectId,
    });
    log.warn('Using application default credentials for Firebase');
  }
} else {
  app = admin.apps[0]!;
}

// Export Firestore and Auth instances
export const db = getFirestore(app);
export const auth = getAuth(app);

// Collection references
export const collections = {
  users: db.collection('users'),
  items: db.collection('items'),
  creditTransactions: db.collection('creditTransactions'),
  collectionPoints: db.collection('collectionPoints'),
  verifications: db.collection('verifications'),
  settings: db.collection('settings'),
  matches: db.collection('matches'), // Active automatic image matching records
  matchHistory: db.collection('matchHistory'), // Completed matches (persisted)
  handovers: db.collection('handovers'),
  handoverCodes: db.collection('handoverCodes'),
} as const;

export default app;
