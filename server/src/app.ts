/**
 * Express application factory.
 *
 * Building the app has no side effects: no `dotenv`, no `listen`, no process
 * exit. `server.ts` owns the process lifecycle. Keeping them apart is what lets
 * tests import the app and drive it without opening a port.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';

import itemsRoutes from './routes/items.js';
import matchesRoutes from './routes/matches.js';
import notificationsRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
import verificationRoutes from './routes/verification.js';
import handoverRoutes from './routes/handover.js';
import creditsRoutes from './routes/credits.js';
import authRoutes from './routes/auth.js';
import cctvRoutes from './routes/cctv.js';
import aiRoutes from './routes/ai.js';
import usersRoutes from './routes/users.js';
import statsRoutes from './routes/stats.js';
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
  app.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/profile') return profileLimiter(req, res, next);
    if (req.path === '/login-notification') return loginNotificationLimiter(req, res, next);
    return authLimiter(req, res, next);
  });

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
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
    });
  });

  // API ROUTES

  app.use('/api/items', itemsRoutes);
  app.use('/api/matches', matchesRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/verification', verificationRoutes);
  // One router, two mount points. `/api/handovers/user/:userId` and
  // `/api/handover/verify` were separate files with no rule about which
  // endpoint lived where; both paths are kept so no client call changes.
  app.use('/api/handover', handoverRoutes);
  app.use('/api/handovers', handoverRoutes);
  app.use('/api/credits', creditsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/cctv', cctvRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/stats', statsRoutes);

  // ERROR HANDLING

  // 404 handler for undefined routes
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp;
