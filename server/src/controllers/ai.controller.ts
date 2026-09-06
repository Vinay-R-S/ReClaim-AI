/**
 * AI HTTP layer.
 */

import { Request, Response } from 'express';
import { AiService, aiService } from '../services/ai.service.js';
import type { AnalyzeImageBody, EnhanceDescriptionBody } from '../schemas/index.js';

export class AiController {
  constructor(private readonly ai: AiService = aiService) {}

  status = async (_req: Request, res: Response): Promise<Response> => {
    return res.json({ available: this.ai.isAvailable() });
  };

  analyzeImage = async (req: Request, res: Response): Promise<Response> => {
    // Answered here rather than as a thrown 5xx: the error handler sanitises
    // server errors in production, and "AI analysis is not configured" is the
    // one thing the caller can act on.
    if (!this.ai.isAvailable()) {
      return res.status(503).json({ error: 'AI analysis is not configured' });
    }

    return res.json(await this.ai.analyzeImages(req.body as AnalyzeImageBody));
  };

  enhanceDescription = async (req: Request, res: Response): Promise<Response> => {
    return res.json(await this.ai.enhanceDescription(req.body as EnhanceDescriptionBody));
  };
}

export const aiController = new AiController();
