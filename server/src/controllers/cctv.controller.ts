/**
 * CCTV HTTP layer.
 *
 * The interesting part is turning a failed proxy call into something an
 * operator can act on: a timeout, a rejected secret and a process that is not
 * running each need a different thing done about them.
 */

import { Request, Response } from 'express';
import { CctvService, YoloError, cctvService } from '../services/cctv.service.js';
import type { CctvAnalyzeBody, CctvDescribeBody, CctvDetectBody } from '../schemas/index.js';

const FAILURE_RESPONSE: Record<string, { status: number; error: string; details: string }> = {
  timeout: {
    status: 504,
    error: 'YOLO Detection Service timed out',
    details:
      'The service accepted the request but did not answer in time. For a video, try a shorter clip or a longer frame interval.',
  },
  rejected: {
    status: 502,
    error: 'YOLO Detection Service rejected the request',
    details:
      'The shared secret did not match. Check that YOLO_SERVICE_TOKEN is the same in server/.env and in the models environment.',
  },
  unavailable: {
    status: 503,
    error: 'YOLO Detection Service unavailable',
    details: 'Please ensure python app.py is running on port 5000',
  },
};

export class CctvController {
  constructor(private readonly cctv: CctvService = cctvService) {}

  listClasses = async (_req: Request, res: Response): Promise<Response> => {
    return this.proxy(res, () => this.cctv.listClasses());
  };

  detect = async (req: Request, res: Response): Promise<Response> => {
    return this.proxy(res, () => this.cctv.detect(req.body as CctvDetectBody));
  };

  analyze = async (req: Request, res: Response): Promise<Response> => {
    return this.proxy(res, () => this.cctv.analyzeVideo(req.body as CctvAnalyzeBody));
  };

  describe = async (req: Request, res: Response): Promise<Response> => {
    return res.json(await this.cctv.describeItem(req.body as CctvDescribeBody));
  };

  private async proxy(res: Response, run: () => Promise<unknown>): Promise<Response> {
    try {
      return res.json(await run());
    } catch (error) {
      if (!(error instanceof YoloError)) throw error;

      const failure = FAILURE_RESPONSE[error.kind];

      return res.status(failure.status).json({ error: failure.error, details: failure.details });
    }
  }
}

export const cctvController = new CctvController();
