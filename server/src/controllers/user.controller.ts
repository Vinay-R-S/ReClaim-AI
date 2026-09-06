/**
 * User administration HTTP layer.
 */

import { Response } from 'express';
import { UserService, userService } from '../services/user.service.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { UserStatus } from '../types/index.js';

/** Users per page. */
const PAGE_SIZE = 100;

/** One document id. A multi-segment path reaches the SDK as a throw, not a refusal. */
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

export class UserController {
  constructor(private readonly users: UserService = userService) {}

  list = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { cursor, limit } = req.query as { cursor?: string; limit?: string };
    const size = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), PAGE_SIZE);

    if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) {
      throw new AppError('Invalid cursor', 400);
    }

    return res.json(await this.users.listPage(size, cursor));
  };

  setStatus = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { userId } = req.params;
    const { status } = req.body as { status: UserStatus };

    await this.users.setStatus(userId, status, req.user!.uid);

    return res.json({ success: true, userId, status });
  };
}

export const userController = new UserController();
