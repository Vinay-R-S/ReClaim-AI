/**
 * Credit HTTP layer.
 */

import { Request, Response } from 'express';
import { CreditAccountService, creditAccountService } from '../services/credit.account.service.js';

/** The ledger page the profile screen shows. */
const HISTORY_LIMIT = 50;

export class CreditController {
  constructor(private readonly credits: CreditAccountService = creditAccountService) {}

  getBalance = async (req: Request, res: Response): Promise<Response> => {
    return res.json(await this.credits.getBalance(req.params.userId));
  };

  adjust = async (req: Request, res: Response): Promise<Response> => {
    const { amount, reason } = req.body as { amount: number; reason?: string };

    return res.json(await this.credits.adjust(req.params.userId, amount, reason));
  };

  history = async (req: Request, res: Response): Promise<Response> => {
    const history = await this.credits.history(req.params.userId, HISTORY_LIMIT);

    return res.json({ history });
  };
}

export const creditController = new CreditController();
