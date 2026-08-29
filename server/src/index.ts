// Entry point - loads env vars BEFORE importing anything that reads them
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory (not root, for separate hosting)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const log = createLogger('bootstrap');

// Dynamic import so that config/env.ts parses a populated process.env.
import('./server.js').catch((error: unknown) => {
  log.error('Server failed to start', { error });
  process.exit(1);
});
