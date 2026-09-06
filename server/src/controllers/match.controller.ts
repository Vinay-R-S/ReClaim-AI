/**
 * Match HTTP layer.
 */

import { Request, Response } from 'express';
import { MatchService, matchService } from '../services/match.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { MatchVerifyBody } from '../schemas/index.js';

export class MatchController {
  constructor(private readonly matches: MatchService = matchService) {}

  verify = async (req: AuthRequest, res: Response): Promise<Response> => {
    const result = await this.matches.verify(req.body as MatchVerifyBody, req.user!.uid);

    return res.json(result);
  };

  list = async (req: Request, res: Response): Promise<Response> => {
    const matches = await this.matches.listActive();

    return res.json({ matches });
  };

  listAll = async (req: Request, res: Response): Promise<Response> => {
    const matches = await this.matches.listAll();

    return res.json({ matches });
  };
}

export const matchController = new MatchController();
