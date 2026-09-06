/**
 * Handover HTTP layer.
 */

import { Request, Response } from 'express';
import {
  getHandoverStatus,
  initiateHandover,
  verifyHandoverCode,
} from '../services/handover.service.js';
import { HandoverRepository, handoverRepository } from '../repositories/handover.repository.js';
import { settingsRepository } from '../repositories/settings.repository.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { HandoverReissueBody, HandoverVerifyBody } from '../schemas/index.js';

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
