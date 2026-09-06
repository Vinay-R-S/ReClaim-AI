/**
 * Match HTTP layer.
 */

import { Request, Response } from 'express';
import { MatchService, matchService } from '../services/match.service.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { MatchClaimBody, MatchSearchBody, MatchVerifyBody } from '../schemas/index.js';

export class MatchController {
  constructor(private readonly matches: MatchService = matchService) {}

  search = async (req: Request, res: Response): Promise<Response> => {
    const matches = await this.matches.search(req.body as MatchSearchBody);

    return res.json({ matches });
  };

  claim = async (req: AuthRequest, res: Response): Promise<Response> => {
    await this.matches.claim(req.body as MatchClaimBody, req.user!);

    return res.json({
      success: true,
      message: 'Claim submitted. Please visit the collection point with ID for verification.',
    });
  };

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

  listForItem = async (req: Request, res: Response): Promise<Response> => {
    const matches = await this.matches.listForItem(req.params.itemId);

    return res.json({ matches });
  };

  listForUser = async (req: Request, res: Response): Promise<Response> => {
    const results = await this.matches.listForUser(req.params.userId);

    return res.json({ results });
  };
}

export const matchController = new MatchController();
