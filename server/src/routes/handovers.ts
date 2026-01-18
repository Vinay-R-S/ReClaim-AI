import { Router, Request, Response } from 'express';
import { collections } from '../utils/firebase-admin.js';

const router = Router();

/**
 * GET /api/handovers/user/:userId
 * Get all handovers for a specific user (both as lost person and found person)
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID required' });
        }

        // Get handovers where user is either lost person or found person
        const handoversSnapshot = await collections.handovers
            .where('status', '==', 'completed')
            .get();

        const userHandovers = [];

        for (const doc of handoversSnapshot.docs) {
            const data = doc.data();

            // Check if user is involved in this handover
            if (data.lostPersonDetails?.userId === userId || data.foundPersonDetails?.userId === userId) {
                userHandovers.push({
                    id: doc.id,
                    ...data
                });
            }
        }

        // Sort by completion date (newest first)
        userHandovers.sort((a: any, b: any) => {
            const dateA = a.completedAt?.toDate?.() || a.handoverTime?.toDate?.() || new Date(0);
            const dateB = b.completedAt?.toDate?.() || b.handoverTime?.toDate?.() || new Date(0);
            return dateB.getTime() - dateA.getTime();
        });

        return res.json({ handovers: userHandovers });
    } catch (error) {
        console.error('Get handovers error:', error);
        return res.status(500).json({ error: 'Failed to get handovers' });
    }
});

export default router;
