// Main Express app - imported dynamically after env vars are loaded
import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat.js';
import itemsRoutes from './routes/items.js';
import matchesRoutes from './routes/matches.js';
import notificationsRoutes from './routes/notifications.js';
import settingsRoutes from './routes/settings.js';
import verificationRoutes from './routes/verification.js';
import handoverRoutes from './routes/handover.js'; // [NEW]
import creditsRoutes from './routes/credits.js';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/chat', chatRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/handover', handoverRoutes); // Register handover routes
app.use('/api/credits', creditsRoutes);
app.use('/api/auth', authRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, () => {
    console.log(`ReClaim AI Server running on http://localhost:${PORT}`);
});

export default app;
