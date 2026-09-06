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
import type { HandoverInitiateBody, HandoverVerifyBody } from '../schemas/index.js';

export class HandoverController {
  constructor(private readonly handovers: HandoverRepository = handoverRepository) {}

  /**
   * Open a session, or re-open one that failed attempts blocked.
   *
   * `reissueBlocked` is the only difference between the two endpoints, so they
   * share a handler rather than diverging over time.
   */
  private issue = (reissueBlocked: boolean) => async (req: AuthRequest, res: Response) => {
    const { matchId, lostItemId, foundItemId, overrideCriteria, overrideReason } =
      req.body as HandoverInitiateBody;

    const result = await initiateHandover(matchId, lostItemId, foundItemId, {
      actorId: req.user?.uid,
      overrideCriteria,
      overrideReason,
      reissueBlocked,
    });

    if (!result.success) {
      throw new AppError(result.message, 400, { criteriaFailure: result.criteriaFailure });
    }

    return res.json(result);
  };

  initiate = this.issue(false);

  reissue = this.issue(true);

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

export const handoverController = new HandoverController();
