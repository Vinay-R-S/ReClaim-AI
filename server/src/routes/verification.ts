/**
 * Verification API Routes
 * Handle item ownership verification flow
 */

import { Router, Request, Response } from 'express';
import {
    startVerification,
    submitVerificationAnswer,
    completeVerification,
    getVerification,
} from '../services/verificationAgent.js';
import { sendVerificationSuccessEmail } from '../services/email.js';
import { collections } from '../utils/firebase-admin.js';
import { Item } from '../types/index.js';

const router = Router();

/**
 * POST /api/verification/start
 * Start a verification process for an item claim
 */
router.post('/start', async (req: Request, res: Response) => {
    try {
        const { itemId, userId, email } = req.body;

        if (!itemId || !userId || !email) {
            return res.status(400).json({ error: 'Missing required fields: itemId, userId, email' });
        }

        // Check if item exists and is claimable
        const itemDoc = await collections.items.doc(itemId).get();
        if (!itemDoc.exists) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const item = itemDoc.data() as Item;
        if (item.status !== 'Pending' && item.status !== 'Matched') {
            return res.status(400).json({ error: 'Item is not available for claiming' });
        }

        const verification = await startVerification(itemId, userId, email);
        if (!verification) {
            return res.status(500).json({ error: 'Failed to start verification' });
        }

        // Return first question
        return res.json({
            verificationId: verification.id,
            totalQuestions: verification.questions.length,
            currentQuestion: 0,
            question: verification.questions[0]?.question,
            status: verification.status,
        });
    } catch (error) {
        console.error('Start verification error:', error);
        return res.status(500).json({ error: 'Failed to start verification' });
    }
});

/**
 * POST /api/verification/:id/answer
 * Submit an answer to a verification question
 */
router.post('/:id/answer', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { questionIndex, answer } = req.body;

        if (questionIndex === undefined || !answer) {
            return res.status(400).json({ error: 'Missing required fields: questionIndex, answer' });
        }

        const result = await submitVerificationAnswer(id, questionIndex, answer);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        const verification = result.verification!;

        // Check if there are more questions
        const nextQuestionIndex = questionIndex + 1;
        const hasMoreQuestions = nextQuestionIndex < verification.questions.length;

        // If verification is complete and passed, handle resolution
        if (verification.status === 'passed') {
            // Complete the verification and update item
            const completionResult = await completeVerification(id);

            if (completionResult.success && completionResult.item) {
                // Send success email
                await sendVerificationSuccessEmail(
                    verification.claimantEmail,
                    completionResult.item.name,
                    verification.confidenceScore,
                    completionResult.item.collectionPoint || 'Main Office - Please contact support for pickup details',
                    completionResult.item.collectionInstructions
                );
            }
        }

        return res.json({
            verificationId: id,
            status: verification.status,
            confidenceScore: verification.confidenceScore,
            hasMoreQuestions,
            nextQuestionIndex: hasMoreQuestions ? nextQuestionIndex : null,
            nextQuestion: hasMoreQuestions ? verification.questions[nextQuestionIndex]?.question : null,
            scoreForThisAnswer: verification.questions[questionIndex]?.score,
        });
    } catch (error) {
        console.error('Submit answer error:', error);
        return res.status(500).json({ error: 'Failed to submit answer' });
    }
});

/**
 * GET /api/verification/:id
 * Get verification status
 */
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const verification = await getVerification(id);
        if (!verification) {
            return res.status(404).json({ error: 'Verification not found' });
        }

        return res.json({
            id: verification.id,
            itemId: verification.itemId,
            status: verification.status,
            confidenceScore: verification.confidenceScore,
            questions: verification.questions.map((q, i) => ({
                index: i,
                question: q.question,
                answered: q.userAnswer !== undefined,
                score: q.score,
            })),
            createdAt: verification.createdAt,
            completedAt: verification.completedAt,
        });
    } catch (error) {
        console.error('Get verification error:', error);
        return res.status(500).json({ error: 'Failed to get verification' });
    }
});

/**
 * GET /api/verification/item/:itemId
 * Get all verifications for an item
 */
router.get('/item/:itemId', async (req: Request, res: Response) => {
    try {
        const { itemId } = req.params;

        const snapshot = await collections.verifications
            .where('itemId', '==', itemId)
            .orderBy('createdAt', 'desc')
            .get();

        const verifications = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return res.json({ verifications });
    } catch (error) {
        console.error('Get item verifications error:', error);
        return res.status(500).json({ error: 'Failed to get verifications' });
    }
});

export default router;
