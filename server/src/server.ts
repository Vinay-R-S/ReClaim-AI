/**
 * Process lifecycle: validate configuration, build the app, open the port.
 *
 * Imported dynamically by `index.ts` after `dotenv` has run, because `env.ts`
 * parses `process.env` at import time.
 */

import { env } from './config/env.js';
import { createApp } from './app.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

env.warnings.forEach((warning) => log.warn(`Configuration warning: ${warning}`));

if (env.deprecatedVarsInUse.length > 0) {
  log.warn('Deprecated VITE_ prefixed variables are supplying server config', {
    variables: env.deprecatedVarsInUse,
  });
}

const app = createApp();

const server = app.listen(env.port, () => {
  log.info('ReClaim AI server listening', {
    url: `http://localhost:${env.port}`,
    environment: env.nodeEnv,
  });
});

export { app, server };
