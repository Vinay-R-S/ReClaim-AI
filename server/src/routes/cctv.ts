
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/index.js';
import fetch from 'node-fetch';

const router = Router();

// Python YOLO service URL
const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:5000';

/**
 * POST /api/cctv/detect
 * Proxy detection request to Python service
 */
router.post('/detect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { image, targetClasses } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'Image data is required' });
        }

        // Call Python Service
        try {
            const response = await fetch(`${YOLO_SERVICE_URL}/detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image, targetClasses })
            });

            if (!response.ok) {
                throw new Error(`Python service responded with ${response.status}`);
            }

            const data = await response.json();
            return res.json(data);

        } catch (connError: any) {
            console.error('Failed to connect to YOLO service:', connError.message);
            // Fallback for demo if python service is down? 
            // For now, return error to encourage running the service.
            return res.status(503).json({ 
                error: 'YOLO Detection Service unavailable', 
                details: 'Please ensure python app.py is running on port 5000' 
            });
        }

    } catch (error: any) {
        console.error('CCTV route error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
