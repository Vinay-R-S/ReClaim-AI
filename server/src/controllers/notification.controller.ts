/**
 * Notification HTTP layer.
 */

import { Request, Response } from 'express';
import {
  isEmailConfigured,
  sendClaimConfirmation,
  sendMatchNotification,
} from '../services/email.service.js';
import { getCreditHistory, getUserCredits } from '../services/credits.service.js';

/** The score a manually triggered match email quotes when none was given. */
const DEFAULT_MATCH_SCORE = 80;

export class NotificationController {
  status = async (_req: Request, res: Response): Promise<Response> => {
    return res.json({
      email: isEmailConfigured(),
      push: false, // Not implemented yet
    });
  };

  sendMatch = async (req: Request, res: Response): Promise<Response> => {
    const { email, itemName, matchScore, collectionPoint } = req.body as {
      email: string;
      itemName: string;
      matchScore?: number;
      collectionPoint?: string;
    };

    const success = await sendMatchNotification(
      email,
      itemName,
      matchScore || DEFAULT_MATCH_SCORE,
      collectionPoint,
    );

    return res.json({ success });
  };

  sendClaim = async (req: Request, res: Response): Promise<Response> => {
    const { email, itemName, collectionPoint } = req.body as {
      email: string;
      itemName: string;
      collectionPoint: string;
    };

    const success = await sendClaimConfirmation(email, itemName, collectionPoint);

    return res.json({ success });
  };

  credits = async (req: Request, res: Response): Promise<Response> => {
    const { userId } = req.params;

    const [credits, history] = await Promise.all([
      getUserCredits(userId),
      getCreditHistory(userId),
    ]);

    return res.json({ credits, history });
  };
}

export const notificationController = new NotificationController();
