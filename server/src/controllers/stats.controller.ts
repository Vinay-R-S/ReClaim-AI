/**
 * Dashboard statistics HTTP layer.
 */

import { Request, Response } from 'express';
import { StatsService, statsService } from '../services/stats.service.js';

export class StatsController {
  constructor(private readonly stats: StatsService = statsService) {}

  dashboard = async (_req: Request, res: Response): Promise<Response> => {
    return res.json(await this.stats.dashboard());
  };
}

export const statsController = new StatsController();
