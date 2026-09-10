/**
 * Handover HTTP layer.
 */

import { Request, Response } from 'express';
import {
  confirmHandoverReceipt,
  getHandoverHistory,
  getHandoverStatus,
  initiateHandover,
  issueHandoverQr,
  verifyHandoverCode,
} from '../services/handover.service.js';
import { HandoverRepository, handoverRepository } from '../repositories/handover.repository.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type {
  HandoverConfirmBody,
  HandoverReissueBody,
  HandoverVerifyBody,
} from '../schemas/index.js';

export class HandoverController {
  constructor(private readonly handovers: HandoverRepository = handoverRepository) {}

  /**
   * Re-open a session that failed attempts blocked, or that expired.
   *
   * A session is normally opened by the admin verifying the match; this is the
   * only way back once one has been blocked, because the code is hashed and
   * verification refuses a blocked session outright.
   */
  reissue = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId, lostItemId, foundItemId, overrideCriteria, overrideReason } =
      req.body as HandoverReissueBody;

    const result = await initiateHandover(matchId, lostItemId, foundItemId, {
      actorId: req.user?.uid,
      overrideCriteria,
      overrideReason,
      reissueBlocked: true,
    });

    if (!result.success) {
      throw new AppError(result.message, 400, { criteriaFailure: result.criteriaFailure });
    }

    return res.json(result);
  };

  /**
   * A wrong code is a 200 with `success: false`, not an error: the page shows
   * the attempts left, which is part of the answer rather than a failure.
   */
  verify = async (req: Request, res: Response): Promise<Response> => {
    const { matchId, code } = req.body as HandoverVerifyBody;

    return res.json(await verifyHandoverCode(matchId, code));
  };

  /**
   * The second party confirms, closing a two-party handover.
   *
   * The party entitled to confirm is the one who reported the *found* item,
   * and that is the whole security argument. The six-digit code is emailed to
   * the person who lost the item and the verification link to the person who
   * found it, so the owner already holds the credential: gating confirmation
   * on the owner as well would let one person present their own code and then
   * confirm their own receipt, which is exactly what two-party exists to stop.
   * Requiring the other side means neither can finish alone — the owner cannot
   * confirm, and the finder cannot present a code they were never sent.
   */
  confirm = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId } = req.body as HandoverConfirmBody;
    const uid = req.user?.uid;

    if (!uid) throw new AppError('Authentication required', 401);

    const session = await this.handovers.findSessionByMatch(matchId);

    if (!session) throw new AppError('Handover session not found', 404);

    const isAdmin = req.user?.role === 'admin';
    const finder = await this.handovers.ownerOf(session.foundItemId);

    if (!isAdmin && finder !== uid) {
      throw new AppError('Only the person who reported the found item can confirm a handover', 403);
    }

    const result = await confirmHandoverReceipt(matchId, uid, isAdmin ? 'admin' : 'finder');

    if (!result.success) throw new AppError(result.message, 409);

    return res.json(result);
  };

  /**
   * A short-lived QR token for the owner to show the finder.
   *
   * The token stands in for the six-digit code, and the code is the owner's,
   * so this is the one endpoint gated on the person who reported the lost
   * item. Minting it for anyone else would hand the credential to the party
   * whose confirmation is supposed to be the second factor.
   */
  qr = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId } = req.params;
    const uid = req.user?.uid;

    if (!uid) throw new AppError('Authentication required', 401);

    const session = await this.handovers.findSessionByMatch(matchId);

    if (!session) throw new AppError('Handover session not found', 404);

    const owner = await this.handovers.ownerOf(session.lostItemId);

    if (req.user?.role !== 'admin' && owner !== uid) {
      throw new AppError('Only the person who reported the lost item can show this code', 403);
    }

    const token = await issueHandoverQr(matchId);

    if (!token) throw new AppError('This handover is not accepting a code', 409);

    return res.json({ token: token.token, expiresAt: token.expiresAt.toISOString() });
  };

  /** The event log for one handover. Admin only: it names both parties. */
  timeline = async (req: AuthRequest, res: Response): Promise<Response> => {
    const events = await getHandoverHistory(req.params.matchId);

    return res.json({
      events: events.map((event) => ({
        ...event,
        at: event.at ? event.at.toISOString() : null,
      })),
    });
  };

  status = async (req: Request, res: Response): Promise<Response> => {
    const status = await getHandoverStatus(req.params.matchId);

    if (!status) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.json(status);
  };

  /**
   * Sessions that have not completed.
   *
   * The hash is deliberately not included: it is the only thing standing
   * between a leaked response and a guessable code.
   */
  sessions = async (_req: Request, res: Response): Promise<Response> => {
    const sessions = (await this.handovers.listOpenSessions()).map((session) => ({
      matchId: session.matchId,
      lostItemId: session.lostItemId,
      foundItemId: session.foundItemId,
      status: session.status,
      attempts: session.attempts ?? 0,
      expiresAt: toIso(session.expiresAt),
      blockedAt: toIso(session.blockedAt),
      criteriaOverrideBy: session.criteriaOverrideBy ?? null,
    }));

    return res.json({ sessions });
  };

  history = async (req: Request, res: Response): Promise<Response> => {
    const history = await this.handovers.listCompleted();

    return res.json({ history });
  };

  listForUser = async (req: Request, res: Response): Promise<Response> => {
    // Once the backfill has run the indexed query is the whole answer, so the
    // legacy scan stops being paid for on every request (defect PERF-03).
    const backfilled = await settingsRepository.handoverParticipantsBackfilled();
    const handovers = await this.handovers.listCompletedForUser(req.params.userId, {
      backfilled,
    });

    return res.json({ handovers });
  };
}

/** A Firestore timestamp as the JSON the screen reads. */
function toIso(value: unknown): string | null {
  const timestamp = value as { toDate?: () => Date } | undefined;

  return timestamp?.toDate?.().toISOString() ?? null;
}

export const handoverController = new HandoverController();
