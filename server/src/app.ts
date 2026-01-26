// Main Express app - imported dynamically after env vars are loaded
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import chatRoutes from './routes/chat.js';
import itemsRoutes from './routes/items.js';
import matchesRoutes from './routes/matches.js';
import notificationsRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
import verificationRoutes from './routes/verification.js';
import handoverRoutes from './routes/handover.js';
import handoversRoutes from './routes/handovers.js';
import creditsRoutes from './routes/credits.js';
import authRoutes from './routes/auth.js';
import cctvRoutes from './routes/cctv.js';
import { authLimiter, apiLimiter, testingApiLimiter, errorHandler, notFoundHandler } from './middleware/index.js';
import { collections } from './utils/firebase-admin.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Cache testing mode to avoid hitting Firebase on every request
let testingModeCache: boolean | null = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 60000; // 1 minute cache

async function isTestingModeEnabled(): Promise<boolean> {
    const now = Date.now();
    if (testingModeCache !== null && (now - lastCacheUpdate) < CACHE_TTL) {
        return testingModeCache;
    }

    try {
        const doc = await collections.settings.doc('system').get();
        testingModeCache = doc.exists ? doc.data()?.testingMode === true : false;
        lastCacheUpdate = now;
        return testingModeCache;
    } catch (error) {
        console.warn('Failed to check testing mode, defaulting to false:', error);
        return false;
    }
}

// Trust proxy - Required for Render/Vercel deployment (fixes express-rate-limit X-Forwarded-For issue)
// Set to 1 to trust the first proxy hop
app.set('trust proxy', 1);

// SECURITY MIDDLEWARE

app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    }
}));

// Security headers (XSS, clickjacking, content-type sniffing protection)
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// CORS configuration with credentials support
app.use(cors({
    origin: [
        'https://re-claim-ai.vercel.app',
        process.env.CLIENT_URL || 'http://localhost:5173',
        'http://localhost:4173'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting on auth routes (stricter)
app.use('/api/auth', authLimiter);

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
        environment: process.env.NODE_ENV || 'development'
    });
});

// API ROUTES
app.use('/api/chat', chatRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/handover', handoverRoutes);
app.use('/api/handovers', handoversRoutes);
app.use('/api/credits', creditsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cctv', cctvRoutes);

// ERROR HANDLING

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler (must be last)
app.use(errorHandler);

// START SERVER
app.listen(PORT, () => {
    console.log(`ReClaim AI Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
