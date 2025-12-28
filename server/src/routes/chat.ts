/**
 * Chat API Routes - Handle chat interactions
 */

import { Router, Request, Response } from 'express';
import { processChat } from '../services/aiAgent.js';
import { ChatRequest, ChatResponse } from '../types/index.js';

const router = Router();

/**
 * POST /api/chat
 * Process a chat message
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        const request: ChatRequest = {
            conversationId: req.body.conversationId,
            message: req.body.message || '',
            context: req.body.context,
            imageData: req.body.imageData,
            location: req.body.location,
        };

        const response = await processChat(userId, request);

        return res.json(response);
    } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({
            error: 'Failed to process chat',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});

/**
 * POST /api/chat/start
 * Start a new conversation with a specific context
 */
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { userId, context } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'User ID required' });
        }

        if (!context) {
            return res.status(400).json({ error: 'Context required' });
        }

        const response = await processChat(userId, {
            message: '',
            context,
        });

        return res.json(response);
    } catch (error) {
        console.error('Start chat error:', error);
        return res.status(500).json({ error: 'Failed to start conversation' });
    }
});

/**
 * GET /api/chat/history/:userId
 * Get chat history for a user
 */
router.get('/history/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        const { limit = '10' } = req.query;

        // Import here to avoid circular deps
        const { collections } = await import('../utils/firebase-admin.js');

        const snapshot = await collections.conversations
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(parseInt(limit as string))
            .get();

        const conversations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({ conversations });
    } catch (error) {
        console.error('Get history error:', error);
        return res.status(500).json({ error: 'Failed to get chat history' });
    }
});

export default router;
