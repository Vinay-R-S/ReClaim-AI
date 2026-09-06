/**
 * User administration HTTP layer.
 */

import { Response } from 'express';
import { UserService, userService } from '../services/user.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { UserStatus } from '../types/index.js';

export class UserController {
  constructor(private readonly users: UserService = userService) {}

  setStatus = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { userId } = req.params;
    const { status } = req.body as { status: UserStatus };

    await this.users.setStatus(userId, status, req.user!.uid);

    return res.json({ success: true, userId, status });
  };
}

export const userController = new UserController();
