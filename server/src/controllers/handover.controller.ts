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
import { handoverRevertService } from '../services/handover/handover.revert.js';
import { stateOf } from '../services/handover/handover.machine.js';
import type {
  HandoverConfirmBody,
  HandoverDisputeBody,
  HandoverDisputeResolveBody,
  HandoverReissueBody,
  HandoverRevertBody,
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

  /**
   * The event log for one handover. Admin only: it names both parties.
   *
   * An empty log is answered as empty rather than as an error, and said so
   * explicitly. A session that predates the event log has no history until the
   * state backfill runs, and an admin deciding a dispute about one needs to
   * know they are looking at a gap in the record rather than at a handover
   * nothing ever happened to.
   */
  timeline = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId } = req.params;
    const [events, session] = await Promise.all([
      getHandoverHistory(matchId),
      this.handovers.findSessionByMatch(matchId),
    ]);

    return res.json({
      events: events.map((event) => ({
        ...event,
        at: event.at ? event.at.toISOString() : null,
      })),
      // True when the session exists but has no log: the backfill has not run
      // for it. False for a session that does not exist at all.
      predatesLog: Boolean(session) && events.length === 0,
    });
  };

  /**
   * Undo a completed handover.
   *
   * Admin only, and the reason is required by the schema: it is written into
   * the correction notice both parties receive and into the audit trail a
   * later dispute is read from.
   *
   * A partial revert answers 409 rather than 200 with a failure inside it. The
   * compensations that ran are recorded and the admin is told where it
   * stopped, because a half-undone handover is a thing somebody has to act on
   * rather than a result to be read past.
   */
  revert = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId, reason } = req.body as HandoverRevertBody;
    const uid = req.user?.uid;

    if (!uid) throw new AppError('Authentication required', 401);

    const result = await handoverRevertService.revert(matchId, reason, uid);

    if (!result.success) {
      throw new AppError(result.message, 409, { compensations: result.compensations });
    }

    return res.json(result);
  };

  /**
   * Either party says a completed handover is wrong.
   *
   * The caller's role is resolved from the handover rather than trusted from
   * the body, and somebody who is neither party is refused: a dispute freezes
   * credits and reopens a settled record, so it is not something a passer-by
   * can raise about somebody else's handover.
   */
  dispute = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId, reason, note } = req.body as HandoverDisputeBody;
    const uid = req.user?.uid;

    if (!uid) throw new AppError('Authentication required', 401);

    const party = await this.partyFor(matchId, uid, req.user?.role === 'admin');

    if (!party) {
      throw new AppError('Only a party to this handover can dispute it', 403);
    }

    const result = await handoverRevertService.raiseDispute(
      matchId,
      uid,
      party,
      reason,
      note ?? null,
    );

    if (!result.success) throw new AppError(result.message, 409);

    return res.json(result);
  };

  /** An admin decides a dispute: uphold it and revert, or reject it. */
  resolveDispute = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { matchId, outcome, note } = req.body as HandoverDisputeResolveBody;
    const uid = req.user?.uid;

    if (!uid) throw new AppError('Authentication required', 401);

    const result = await handoverRevertService.resolveDispute(matchId, uid, outcome, note);

    if (!result.success) {
      throw new AppError(result.message, 409, { compensations: result.compensations });
    }

    return res.json(result);
  };

  /** The open disputes, for the admin queue. */
  disputes = async (_req: AuthRequest, res: Response): Promise<Response> => {
    return res.json({ disputes: await handoverRevertService.listOpenDisputes() });
  };

  /**
   * Which side of a handover a caller is on, if either.
   *
   * Resolved from the two items rather than from the request, for the same
   * reason confirmation is: the body is written by whoever is calling.
   */
  private async partyFor(
    matchId: string,
    uid: string,
    isAdmin: boolean,
  ): Promise<'owner' | 'finder' | 'admin' | null> {
    const session = await this.handovers.findSessionByMatch(matchId);

    if (!session) throw new AppError('Handover session not found', 404);

    const [owner, finder] = await Promise.all([
      this.handovers.ownerOf(session.lostItemId),
      this.handovers.ownerOf(session.foundItemId),
    ]);

    if (owner === uid) return 'owner';
    if (finder === uid) return 'finder';

    return isAdmin ? 'admin' : null;
  }

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
      // The machine state as well as the legacy projection. Without it the
      // admin list cannot tell an open session from one stranded at
      // `verified` — both project to `pending` — and the stranded one is
      // exactly the session that needs the reopen button.
      state: stateOf(session as unknown as Record<string, unknown>),
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
