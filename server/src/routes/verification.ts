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
import {
  assertOwnerOrAdmin,
  asyncHandler,
  authMiddleware,
  AuthRequest,
  requireActiveUser,
  requireAdmin,
} from '../middleware/index.js';
import { AppError } from '../middleware/index.js';

const router = Router();

/**
 * POST /api/verification/start
 * Start a verification process for an item claim
 */
router.post(
  '/start',
  authMiddleware,
  requireActiveUser,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Claimant identity comes from the verified token. Taking it from the body
    // let an anonymous caller open a verification attributed to any uid and
    // route the success email, with the collection point in it, anywhere
    // (SEC-10).
    const userId = req.user!.uid;
    const email = req.user!.email;
    const { itemId } = req.body;

    if (!itemId) {
      return res.status(400).json({ error: 'Missing required field: itemId' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Your account has no email address' });
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
      throw new AppError('Failed to start verification', 500);
    }

    // Return first question
    return res.json({
      verificationId: verification.id,
      totalQuestions: verification.questions.length,
      currentQuestion: 0,
      question: verification.questions[0]?.question,
      status: verification.status,
    });
  }),
);

/**
 * POST /api/verification/:id/answer
 * Submit an answer to a verification question
 */
router.post(
  '/:id/answer',
  authMiddleware,
  requireActiveUser,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { questionIndex, answer } = req.body;

    if (questionIndex === undefined || !answer) {
      return res.status(400).json({ error: 'Missing required fields: questionIndex, answer' });
    }

    const session = await getVerification(id);
    if (!session) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    // Session ids are guessable, and passing the questions resolves the item
    // and emails the collection point, so only the claimant may answer.
    if (!assertOwnerOrAdmin(req.user, session.claimantUserId)) {
      return res.status(403).json({ error: 'This verification belongs to another user' });
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
          completionResult.item.collectionPoint ||
            'Main Office - Please contact support for pickup details',
          completionResult.item.collectionInstructions,
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
  }),
);

/**
 * GET /api/verification/:id
 * Get verification status
 */
router.get(
  '/:id',
  authMiddleware,
  requireActiveUser,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { id } = req.params;

    const verification = await getVerification(id);
    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    if (!assertOwnerOrAdmin(req.user, verification.claimantUserId)) {
      return res.status(403).json({ error: 'This verification belongs to another user' });
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
  }),
);

/**
 * GET /api/verification/item/:itemId
 * Get all verifications for an item
 */
router.get(
  '/item/:itemId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = req.params;

    const snapshot = await collections.verifications
      .where('itemId', '==', itemId)
      .orderBy('createdAt', 'desc')
      .get();

    const verifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ verifications });
  }),
);

export default router;
