import { Router, Response } from 'express';
import {
  asyncHandler,
  authMiddleware,
  AuthRequest,
  requireAdmin,
  validate,
} from '../middleware/index.js';
import { cctvAnalyzeSchema, cctvDescribeSchema, cctvDetectSchema } from '../schemas/index.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { callLLM } from '../utils/llm.js';

const log = createLogger('cctv');

const router = Router();

// Python YOLO service URL
const YOLO_SERVICE_URL = env.yolo.serviceUrl;

/**
 * Ceilings on a call to the Flask service.
 *
 * Every proxy call used to be an unbounded `fetch`. A Flask process that
 * accepted the connection and then stalled, on a model load or a frame it
 * could not decode, held the Express request open with it and the admin saw a
 * spinner with no end. Video analysis gets its own budget because it runs YOLO
 * over every frame in the batch.
 */
const YOLO_TIMEOUT_MS = {
  classes: 10000,
  detect: 30000,
  analyze: 120000,
} as const;

/**
 * Call the Flask service with a deadline.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`, which is tagged here so
 * the handler can tell "took too long" apart from "not running": they need
 * different things done about them.
 */
async function callYolo(
  path: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<globalThis.Response> {
  try {
    return await fetch(`${YOLO_SERVICE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
      const timeout = new Error(`YOLO service did not respond within ${timeoutMs}ms`) as Error & {
        yoloTimeout: boolean;
      };
      timeout.yoloTimeout = true;
      throw timeout;
    }

    throw error;
  }
}

/**
 * The Flask service is reachable on the network and has no user accounts, so
 * the two processes share a secret instead. Flask refuses anything without it
 * (SEC-20).
 */
function yoloHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = env.yolo.serviceToken;
  return token ? { ...extra, 'X-Service-Token': token } : extra;
}

/**
 * Turn a failed proxy call into something an operator can act on.
 *
 * A rejected shared secret and an unreachable process are different problems,
 * and telling someone to check that a running service is running wastes their
 * time.
 */
function yoloFailure(res: Response, error: unknown) {
  const status = (error as { yoloStatus?: number }).yoloStatus;

  if ((error as { yoloTimeout?: boolean }).yoloTimeout) {
    return res.status(504).json({
      error: 'YOLO Detection Service timed out',
      details:
        'The service accepted the request but did not answer in time. For a video, try a shorter clip or a longer frame interval.',
    });
  }

  if (status === 401 || status === 403 || status === 503) {
    return res.status(502).json({
      error: 'YOLO Detection Service rejected the request',
      details:
        'The shared secret did not match. Check that YOLO_SERVICE_TOKEN is the same in server/.env and in the models environment.',
    });
  }

  return res.status(503).json({
    error: 'YOLO Detection Service unavailable',
    details: 'Please ensure python app.py is running on port 5000',
  });
}

function yoloError(response: { status: number }): Error {
  const error = new Error(`Python service responded with ${response.status}`) as Error & {
    yoloStatus: number;
  };
  error.yoloStatus = response.status;
  return error;
}

// GET /api/cctv/classes - Get all YOLO class names for dropdown
router.get(
  '/classes',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const response = await callYolo('/classes', YOLO_TIMEOUT_MS.classes, {
        headers: yoloHeaders(),
      });
      if (!response.ok) throw yoloError(response);
      return res.json(await response.json());
    } catch (connError: any) {
      log.error('YOLO service error:', connError.message);
      return yoloFailure(res, connError);
    }
  }),
);

// POST /api/cctv/detect - Proxy to Python YOLO service
router.post(
  '/detect',
  authMiddleware,
  requireAdmin,
  validate(cctvDetectSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { image, targetClasses, targetClass } = req.body;

    try {
      const response = await callYolo('/detect', YOLO_TIMEOUT_MS.detect, {
        method: 'POST',
        headers: yoloHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ image, targetClasses, targetClass }),
      });

      if (!response.ok) throw yoloError(response);
      return res.json(await response.json());
    } catch (connError: any) {
      log.error('YOLO service error:', connError.message);
      return yoloFailure(res, connError);
    }
  }),
);

// POST /api/cctv/analyze - Video analysis with Groq AI
router.post(
  '/analyze',
  authMiddleware,
  requireAdmin,
  validate(cctvAnalyzeSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { frames, targetClass, itemName, itemDescription } = req.body;

    // Call Python YOLO service
    let yoloResult: any;
    try {
      const response = await callYolo('/analyze-video', YOLO_TIMEOUT_MS.analyze, {
        method: 'POST',
        headers: yoloHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          frames,
          targetClass: targetClass || '',
          itemName: itemName || '',
          itemDescription: itemDescription || '',
        }),
      });
      if (!response.ok) throw yoloError(response);
      yoloResult = await response.json();
    } catch (connError: any) {
      log.error('YOLO service error:', connError.message);
      return yoloFailure(res, connError);
    }

    // Call Groq for AI analysis
    let aiAnalysis = {
      matchConfidence: yoloResult.stats?.maxConfidence || 0,
      explanation: '',
      recommendations: [] as string[],
    };

    try {
      if (yoloResult.keyframes?.length > 0) {
        const prompt = `You are an AI assistant helping to verify if a detected object matches a lost item report.

Lost Item Details:
- Name: ${itemName || 'Unknown'}
- Description: ${itemDescription || 'No description provided'}
- Category: ${targetClass || 'Unknown'}

Detection Results:
- Object Type Detected: ${yoloResult.targetClass}
- Number of Keyframes: ${yoloResult.keyframes.length}
- Average Confidence: ${yoloResult.stats.averageConfidence}%
- Max Confidence: ${yoloResult.stats.maxConfidence}%

Respond in JSON format:
{
"matchConfidence": number,
"explanation": "string",
"recommendations": ["string", "string"]
}`;

        // Through `callLLM`, not a hardcoded Groq call: the admin provider
        // setting is what decides which model runs, and going direct meant
        // selecting Gemini or Grok changed matching but left CCTV on Groq.
        const { content } = await callLLM(
          [
            {
              role: 'system',
              content:
                'You are an AI assistant that analyzes object detection results. Always respond with valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.3, maxTokens: 512 },
        );

        try {
          const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
          const parsed = JSON.parse(jsonMatch[1]?.trim() || content.trim());
          aiAnalysis = {
            matchConfidence: parsed.matchConfidence || yoloResult.stats.maxConfidence,
            explanation: parsed.explanation || 'AI analysis completed.',
            recommendations: parsed.recommendations || [],
          };
        } catch {
          aiAnalysis.explanation = 'Detection analysis completed. Visual verification recommended.';
          aiAnalysis.recommendations = ['Verify object visually', 'Check distinguishing features'];
        }
      } else {
        aiAnalysis.explanation = 'No matching objects found.';
        aiAnalysis.recommendations = ['Try uploading a different video'];
      }
    } catch (aiError: any) {
      // A provider being down or unconfigured is not a failed analysis: the
      // YOLO keyframes are the result, and the commentary is the extra.
      log.error('CCTV analysis LLM error:', aiError.message);
      aiAnalysis.explanation = 'AI analysis unavailable. Manual review recommended.';
      aiAnalysis.recommendations = ['Review keyframes manually'];
    }

    return res.json({
      success: true,
      keyframes: yoloResult.keyframes || [],
      stats: yoloResult.stats || {},
      aiAnalysis,
    });
  }),
);

// POST /api/cctv/describe - AI image description
router.post(
  '/describe',
  authMiddleware,
  requireAdmin,
  validate(cctvDescribeSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { image, detectedClass } = req.body;

    const defaultResponse = {
      success: true,
      name: `Found ${detectedClass || 'Item'}`,
      description: `Item detected via CCTV. Object identified as ${detectedClass || 'unknown'}.`,
      category: detectedClass || 'Other',
      tags: [detectedClass?.toLowerCase() || 'item', 'found', 'cctv'],
      color: 'Unknown',
    };

    const imageData = image.includes(',') ? image.split(',')[1] : image;
    const prompt = `Analyze this found item image (detected as "${detectedClass || 'unknown'}"). Respond in JSON:
{
"name": "Descriptive name",
"description": "Detailed description",
"category": "Electronics/Bags/Clothing/Accessories/Documents/Keys/Wallet/Sports/Books/Other",
"tags": ["tag1", "tag2"],
"color": "Primary color"
}`;

    // Through `callLLM` so the admin provider setting decides the model, and
    // so an unconfigured or failing provider falls through to the descriptive
    // default rather than 500ing the register-as-found flow.
    let content = '';

    try {
      const result = await callLLM(
        [
          { role: 'system', content: 'Analyze found item images. Respond with valid JSON.' },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.3, maxTokens: 512, imageBase64: imageData, imageMimeType: 'image/jpeg' },
      );
      content = result.content;
    } catch (error) {
      log.error('CCTV describe LLM error:', error);
      return res.json(defaultResponse);
    }

    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const parsed = JSON.parse(jsonMatch[1]?.trim() || content.trim());
      return res.json({
        success: true,
        name: parsed.name || defaultResponse.name,
        description: parsed.description || defaultResponse.description,
        category: parsed.category || detectedClass || 'Other',
        tags: parsed.tags || [detectedClass?.toLowerCase() || 'item'],
        color: parsed.color || 'Unknown',
      });
    } catch {
      return res.json(defaultResponse);
    }
  }),
);

export default router;
