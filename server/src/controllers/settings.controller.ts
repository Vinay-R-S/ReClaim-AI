/**
 * Settings HTTP layer.
 */

import { Request, Response } from 'express';
import { SettingsService, settingsService } from '../services/settings.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { SettingsUpdateBody } from '../schemas/index.js';

export class SettingsController {
  constructor(private readonly settings: SettingsService = settingsService) {}

  getSystem = async (_req: Request, res: Response): Promise<Response> => {
    return res.json(await this.settings.getSystem());
  };

  updateSystem = async (req: Request, res: Response): Promise<Response> => {
    const settings = await this.settings.updateSystem(req.body as SettingsUpdateBody);

    return res.json({ success: true, ...settings });
  };

  setProfilePicture = async (req: AuthRequest, res: Response): Promise<Response> => {
    const { imageData } = req.body as { imageData: string };
    const photoURL = await this.settings.setProfilePicture(req.user!.uid, imageData);

    return res.json({ success: true, photoURL });
  };

  getMode = async (_req: Request, res: Response): Promise<Response> => {
    return res.json(await this.settings.getMode());
  };

  recordVisit = async (_req: Request, res: Response): Promise<Response> => {
    await this.settings.recordVisit();

    return res.json({ success: true });
  };

  getAnalytics = async (_req: Request, res: Response): Promise<Response> => {
    return res.json(await this.settings.getAnalytics());
  };
}

export const settingsController = new SettingsController();
