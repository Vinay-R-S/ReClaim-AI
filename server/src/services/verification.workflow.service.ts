/**
 * The claim verification workflow.
 *
 * `verification.service.ts` owns the questions and the scoring; this owns the
 * flow around them: who may answer, what happens when the score passes, and
 * what the caller is told at each step.
 */

import {
  completeVerification,
  getVerification,
  startVerification,
  submitVerificationAnswer,
} from './verification.service.js';
import { sendVerificationSuccessEmail } from './email.service.js';
import { ItemRepository, itemRepository } from '../repositories/item.repository.js';
import {
  VerificationRepository,
  verificationRepository,
} from '../repositories/verification.repository.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthUser } from '../middleware/auth.middleware.js';
import type { Verification } from '../types/index.js';

/** Where to send a claimant when the item carries no collection point. */
const DEFAULT_COLLECTION_POINT = 'Main Office - Please contact support for pickup details';

export interface StartedVerification {
  verificationId: string;
  totalQuestions: number;
  currentQuestion: number;
  question?: string;
  status: Verification['status'];
}

export interface AnswerOutcome {
  verificationId: string;
  status: Verification['status'];
  confidenceScore: number;
  hasMoreQuestions: boolean;
  nextQuestionIndex: number | null;
  nextQuestion: string | null;
  scoreForThisAnswer?: number;
}

function isOwnerOrAdmin(user: AuthUser | undefined, ownerId: string | undefined): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return Boolean(ownerId) && user.uid === ownerId;
}

export class VerificationWorkflowService {
  constructor(
    private readonly items: ItemRepository = itemRepository,
    private readonly verifications: VerificationRepository = verificationRepository,
  ) {}

  /**
   * Open a verification session.
   *
   * The claimant is whoever holds the token. Taking it from the body let an
   * anonymous caller open a verification attributed to any uid and route the
   * success email, with the collection point in it, anywhere (defect SEC-10).
   */
  async start(itemId: string, user: AuthUser): Promise<StartedVerification> {
    if (!user.email) {
      throw new AppError('Your account has no email address', 400);
    }

    const item = await this.items.findById(itemId);

    if (!item) throw new AppError('Item not found', 404);

    if (item.status !== 'Pending' && item.status !== 'Matched') {
      throw new AppError('Item is not available for claiming', 400);
    }

    const verification = await startVerification(itemId, user.uid, user.email);

    if (!verification) {
      throw new AppError('Failed to start verification', 500);
    }

    return {
      verificationId: verification.id,
      totalQuestions: verification.questions.length,
      currentQuestion: 0,
      question: verification.questions[0]?.question,
      status: verification.status,
    };
  }

  /**
   * Score one answer, and close the claim out if that was the last one needed.
   *
   * Session ids are guessable, and passing the questions resolves the item and
   * emails the collection point, so only the claimant may answer.
   */
  async answer(
    id: string,
    questionIndex: number,
    answer: string,
    user: AuthUser,
  ): Promise<AnswerOutcome> {
    const session = await this.loadOwnSession(id, user);

    const result = await submitVerificationAnswer(id, questionIndex, answer);

    if (!result.success) {
      throw new AppError(result.error ?? 'Answer rejected', 400);
    }

    const verification = result.verification!;

    if (verification.status === 'passed') {
      await this.completeAndNotify(id, verification, session.claimantEmail);
    }

    const nextQuestionIndex = questionIndex + 1;
    const hasMoreQuestions = nextQuestionIndex < verification.questions.length;

    return {
      verificationId: id,
      status: verification.status,
      confidenceScore: verification.confidenceScore,
      hasMoreQuestions,
      nextQuestionIndex: hasMoreQuestions ? nextQuestionIndex : null,
      nextQuestion: hasMoreQuestions
        ? (verification.questions[nextQuestionIndex]?.question ?? null)
        : null,
      scoreForThisAnswer: verification.questions[questionIndex]?.score,
    };
  }

  async getForCaller(id: string, user: AuthUser): Promise<Verification> {
    return this.loadOwnSession(id, user);
  }

  listForItem(itemId: string): Promise<Verification[]> {
    return this.verifications.listForItem(itemId);
  }

  private async loadOwnSession(id: string, user: AuthUser): Promise<Verification> {
    const verification = await getVerification(id);

    if (!verification) throw new AppError('Verification not found', 404);

    if (!isOwnerOrAdmin(user, verification.claimantUserId)) {
      throw new AppError('This verification belongs to another user', 403);
    }

    return verification;
  }

  private async completeAndNotify(
    id: string,
    verification: Verification,
    claimantEmail: string,
  ): Promise<void> {
    const completion = await completeVerification(id);

    if (!completion.success || !completion.item) return;

    await sendVerificationSuccessEmail(
      claimantEmail,
      completion.item.name,
      verification.confidenceScore,
      completion.item.collectionPoint || DEFAULT_COLLECTION_POINT,
      completion.item.collectionInstructions,
    );
  }
}

export const verificationWorkflowService = new VerificationWorkflowService();
