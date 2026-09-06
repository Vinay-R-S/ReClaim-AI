/**
 * Express application factory.
 *
 * Building the app has no side effects: no `dotenv`, no `listen`, no process
 * exit. `server.ts` owns the process lifecycle. Keeping them apart is what lets
 * tests import the app and drive it without opening a port.
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';

import { routeTable } from './routes/index.js';
import {
  authLimiter,
  loginNotificationLimiter,
  profileLimiter,
  apiLimiter,
  testingApiLimiter,
  errorHandler,
  notFoundHandler,
} from './middleware/index.js';
import { settingsRepository } from './repositories/settings.repository.js';
import { env } from './config/env.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('app');

/**
 * The API version in the path.
 *
 * One number for the whole surface, bumped only for a breaking change, and
 * only alongside a new mount that runs beside the old one. See
 * `docs/adr/0013-api-versioning.md`.
 */
export const API_VERSION = 'v1';

// Cache testing mode to avoid hitting Firebase on every request
let testingModeCache: boolean | null = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 60000; // 1 minute cache

async function isTestingModeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (testingModeCache !== null && now - lastCacheUpdate < CACHE_TTL) {
    return testingModeCache;
  }

  try {
    const settings = await settingsRepository.getSystem();
    testingModeCache = settings?.testingMode === true;
    lastCacheUpdate = now;
    return testingModeCache;
  } catch (error) {
    log.warn('Failed to check testing mode, defaulting to false', { error });
    return false;
  }
}

export function createApp(): express.Express {
  const app = express();

  // Trust proxy - Required for Render/Vercel deployment (fixes express-rate-limit X-Forwarded-For issue)
  // Set to 1 to trust the first proxy hop
  app.set('trust proxy', 1);

  // SECURITY MIDDLEWARE

  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Security headers (XSS, clickjacking, content-type sniffing protection)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  // CORS configuration with credentials support
  app.use(
    cors({
      origin: ['https://re-claim-ai.vercel.app', env.clientUrl, 'http://localhost:4173'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // Rate limiting on auth routes (stricter). Two paths are exempt from the
  // credential limiter: the profile bootstrap runs on every app mount rather
  // than per credential attempt, and the login notice fires once per
  // successful sign-in, so five per IP per fifteen minutes was tripped by
  // ordinary use from a shared address (defect PERF-09).
  //
  // Registered here rather than inside the router below, and mounted once per
  // path, because it has to run BEFORE the general limiter and before the body
  // parser: a credential-stuffing run must be refused without first parsing a
  // 10 MB body and spending the general budget it exists to protect.
  const authRateLimit = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/profile') return profileLimiter(req, res, next);
    if (req.path === '/login-notification') return loginNotificationLimiter(req, res, next);
    return authLimiter(req, res, next);
  };

  app.use(`/api/${API_VERSION}/auth`, authRateLimit);
  app.use('/api/auth', authRateLimit);

  // Conditional testing mode rate limiting (400 calls/day when enabled)
  app.use('/api', async (req: Request, res: Response, next: NextFunction) => {
    const isTestingMode = await isTestingModeEnabled();
    if (isTestingMode) {
      return testingApiLimiter(req, res, next);
    }
    // In Dev mode, use standard rate limiting
    return apiLimiter(req, res, next);
  });

  // BODY PARSING
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // HEALTH CHECK
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      apiVersion: API_VERSION,
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
    });
  });

  // API ROUTES

  const api = Router();

  routeTable.forEach((mount) => api.use(mount.prefix, mount.router));

  // The versioned path is the contract, and `docs/api/openapi.json` describes
  // it (defect ARCH-19). The unversioned mount is the same router kept for
  // every caller written before the version existed; it answers identically
  // and says so in its headers.
  app.use(`/api/${API_VERSION}`, api);
  app.use(
    '/api',
    (req: Request, res: Response, next: NextFunction) => {
      // A path that already names a version reaches here only because that
      // version does not exist. Marking it deprecated and pointing at
      // `/api/v1/v2/...` would be worse than saying nothing, so it falls
      // through to the 404 unannotated.
      if (!/^\/v\d+(\/|$)/.test(req.path)) {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Link', `</api/${API_VERSION}${req.path}>; rel="successor-version"`);
      }

      next();
    },
    api,
  );

  // ERROR HANDLING

  // 404 handler for undefined routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp;
