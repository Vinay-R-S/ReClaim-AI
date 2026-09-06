/**
 * Auth HTTP layer.
 */

import { Response } from 'express';
import { AuthService, authService } from '../services/auth.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { LoginNotificationBody, ProfileBootstrapBody } from '../schemas/index.js';

/** Enough of the address to recognise, not enough to reuse. */
function maskEmail(email: string): string {
  return email.replace(/(.{2}).*(@)/, '$1***$2');
}

export class AuthController {
  constructor(private readonly auth: AuthService = authService) {}

  bootstrapProfile = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { uid, email } = req.user!;
    const body = req.body as ProfileBootstrapBody;

    const result = await this.auth.bootstrapProfile(uid, email, {
      displayName: body.displayName,
      photoURL: body.photoURL,
    });

    return res.status(result.created ? 201 : 200).json(result);
  };

  loginNotification = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { loginTime } = req.body as LoginNotificationBody;

    const email = await this.auth.notifyLogin(req.user!.uid, loginTime);

    return res.json({
      success: true,
      message: 'Login notification sent successfully',
      userEmail: maskEmail(email),
    });
  };
}

export const authController = new AuthController();
