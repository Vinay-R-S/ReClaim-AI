// Worker entry point. Same image as the API, different process: it loads the
// environment the same way and then runs consumers instead of a port.
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const log = createLogger('bootstrap');

// Dynamic import so that config/env.ts parses a populated process.env.
import('./worker.runtime.js').catch((error: unknown) => {
  log.error('Worker failed to start', { error });
  process.exit(1);
});
