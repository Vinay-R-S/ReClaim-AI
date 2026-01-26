// Entry point - loads env vars BEFORE importing the main app
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory (not root, for separate hosting)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Debug - log if env vars are loaded
console.log('Firebase key loaded:', !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

// Now dynamically import the main app
import('./app.js').catch(console.error);
