/**
 * Verification HTTP layer.
 */

import { Request, Response } from 'express';
import {
  VerificationWorkflowService,
  verificationWorkflowService,
} from '../services/verification.workflow.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';

export class VerificationController {
  constructor(
    private readonly verifications: VerificationWorkflowService = verificationWorkflowService,
  ) {}

  start = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { itemId } = req.body as { itemId: string };

    return res.json(await this.verifications.start(itemId, req.user!));
  };

  answer = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { questionIndex, answer } = req.body as { questionIndex: number; answer: string };

    return res.json(
      await this.verifications.answer(req.params.id, questionIndex, answer, req.user!),
    );
  };

  /** The caller's own session, with the answers hidden and only the scores shown. */
  getById = async (req: AuthRequest, res: Response): Promise<Response> => {
    const verification = await this.verifications.getForCaller(req.params.id, req.user!);

    return res.json({
      id: verification.id,
      itemId: verification.itemId,
      status: verification.status,
      confidenceScore: verification.confidenceScore,
      questions: verification.questions.map((question, index) => ({
        index,
        question: question.question,
        answered: question.userAnswer !== undefined,
        score: question.score,
      })),
      createdAt: verification.createdAt,
      completedAt: verification.completedAt,
    });
  };

  listForItem = async (req: Request, res: Response): Promise<Response> => {
    const verifications = await this.verifications.listForItem(req.params.itemId);

    return res.json({ verifications });
  };
}

export const verificationController = new VerificationController();
