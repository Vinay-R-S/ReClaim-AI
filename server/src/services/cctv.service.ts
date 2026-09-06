/**
 * CCTV detection: a client for the Python YOLO service, and the LLM commentary
 * on top of what it finds.
 */

import { callLLM } from '../utils/llm.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import type { CctvAnalyzeBody, CctvDescribeBody, CctvDetectBody } from '../schemas/index.js';

const log = createLogger('cctv.service');

/**
 * Ceilings on a call to the Flask service.
 *
 * Every proxy call used to be an unbounded `fetch`. A Flask process that
 * accepted the connection and then stalled, on a model load or a frame it could
 * not decode, held the Express request open with it and the admin saw a spinner
 * with no end. Video analysis gets its own budget because it runs YOLO over
 * every frame in the batch.
 */
const YOLO_TIMEOUT_MS = {
  classes: 10000,
  detect: 30000,
  analyze: 120000,
} as const;

/** Why a proxy call failed, which decides what the operator is told to check. */
export type YoloFailureKind = 'timeout' | 'rejected' | 'unavailable';

export class YoloError extends Error {
  constructor(
    readonly kind: YoloFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'YoloError';
  }
}

export interface VideoAnalysis {
  success: true;
  keyframes: unknown[];
  stats: Record<string, unknown>;
  aiAnalysis: {
    matchConfidence: number;
    explanation: string;
    recommendations: string[];
  };
}

export class CctvService {
  constructor(private readonly serviceUrl: string = env.yolo.serviceUrl) {}

  listClasses(): Promise<unknown> {
    return this.call('/classes', YOLO_TIMEOUT_MS.classes);
  }

  detect(body: CctvDetectBody): Promise<unknown> {
    return this.call('/detect', YOLO_TIMEOUT_MS.detect, {
      image: body.image,
      targetClasses: body.targetClasses,
      targetClass: body.targetClass,
    });
  }

  /**
   * Run detection over a batch of frames, then ask a model what it means.
   *
   * The keyframes are the result; the commentary is the extra. A provider being
   * down or unconfigured is not a failed analysis, so it degrades to a note
   * rather than an error.
   */
  async analyzeVideo(body: CctvAnalyzeBody): Promise<VideoAnalysis> {
    const yoloResult = (await this.call('/analyze-video', YOLO_TIMEOUT_MS.analyze, {
      frames: body.frames,
      targetClass: body.targetClass || '',
      itemName: body.itemName || '',
      itemDescription: body.itemDescription || '',
    })) as {
      keyframes?: unknown[];
      stats?: { averageConfidence?: number; maxConfidence?: number };
      targetClass?: string;
    };

    const aiAnalysis = await this.describeDetections(body, yoloResult);

    return {
      success: true,
      keyframes: yoloResult.keyframes || [],
      stats: yoloResult.stats || {},
      aiAnalysis,
    };
  }

  /**
   * Name and describe a detected object so it can be registered as found.
   *
   * Falls through to a descriptive default when the model fails, rather than
   * 500ing the register-as-found flow.
   */
  async describeItem(body: CctvDescribeBody): Promise<Record<string, unknown>> {
    const detectedClass = body.detectedClass;
    const fallback = {
      success: true,
      name: `Found ${detectedClass || 'Item'}`,
      description: `Item detected via CCTV. Object identified as ${detectedClass || 'unknown'}.`,
      category: detectedClass || 'Other',
      tags: [detectedClass?.toLowerCase() || 'item', 'found', 'cctv'],
      color: 'Unknown',
    };

    const imageData = body.image.includes(',') ? body.image.split(',')[1] : body.image;
    const prompt = `Analyze this found item image (detected as "${detectedClass || 'unknown'}"). Respond in JSON:
{
"name": "Descriptive name",
"description": "Detailed description",
"category": "Electronics/Bags/Clothing/Accessories/Documents/Keys/Wallet/Sports/Books/Other",
"tags": ["tag1", "tag2"],
"color": "Primary color"
}`;

    let content = '';

    try {
      // Through `callLLM` so the admin provider setting decides the model.
      // Going direct to Groq meant selecting Gemini or Grok changed matching
      // but left CCTV where it was.
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
      return fallback;
    }

    const parsed = parseJsonBlock(content);

    if (!parsed) return fallback;

    return {
      success: true,
      name: parsed.name || fallback.name,
      description: parsed.description || fallback.description,
      category: parsed.category || detectedClass || 'Other',
      tags: parsed.tags || [detectedClass?.toLowerCase() || 'item'],
      color: parsed.color || 'Unknown',
    };
  }

  private async describeDetections(
    body: CctvAnalyzeBody,
    yoloResult: {
      keyframes?: unknown[];
      stats?: { averageConfidence?: number; maxConfidence?: number };
      targetClass?: string;
    },
  ): Promise<VideoAnalysis['aiAnalysis']> {
    const maxConfidence = yoloResult.stats?.maxConfidence || 0;

    if (!yoloResult.keyframes?.length) {
      return {
        matchConfidence: maxConfidence,
        explanation: 'No matching objects found.',
        recommendations: ['Try uploading a different video'],
      };
    }

    const prompt = `You are an AI assistant helping to verify if a detected object matches a lost item report.

Lost Item Details:
- Name: ${body.itemName || 'Unknown'}
- Description: ${body.itemDescription || 'No description provided'}
- Category: ${body.targetClass || 'Unknown'}

Detection Results:
- Object Type Detected: ${yoloResult.targetClass}
- Number of Keyframes: ${yoloResult.keyframes.length}
- Average Confidence: ${yoloResult.stats?.averageConfidence}%
- Max Confidence: ${yoloResult.stats?.maxConfidence}%

Respond in JSON format:
{
"matchConfidence": number,
"explanation": "string",
"recommendations": ["string", "string"]
}`;

    try {
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

      const parsed = parseJsonBlock(content);

      if (!parsed) {
        return {
          matchConfidence: maxConfidence,
          explanation: 'Detection analysis completed. Visual verification recommended.',
          recommendations: ['Verify object visually', 'Check distinguishing features'],
        };
      }

      return {
        matchConfidence: (parsed.matchConfidence as number) || maxConfidence,
        explanation: (parsed.explanation as string) || 'AI analysis completed.',
        recommendations: (parsed.recommendations as string[]) || [],
      };
    } catch (error) {
      log.error('CCTV analysis LLM error:', error);

      return {
        matchConfidence: maxConfidence,
        explanation: 'AI analysis unavailable. Manual review recommended.',
        recommendations: ['Review keyframes manually'],
      };
    }
  }

  /**
   * One call to the Flask service, with a deadline and a shared secret.
   *
   * The two processes have no user accounts between them, so they share a
   * secret instead; Flask refuses anything without it (defect SEC-20).
   */
  private async call(path: string, timeoutMs: number, body?: unknown): Promise<unknown> {
    const token = env.yolo.serviceToken;
    const headers: Record<string, string> = token ? { 'X-Service-Token': token } : {};

    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: globalThis.Response;

    try {
      response = await fetch(`${this.serviceUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = (error as Error).name;

      if (name === 'TimeoutError' || name === 'AbortError') {
        log.error(`YOLO service timed out after ${timeoutMs}ms`);
        throw new YoloError('timeout', `YOLO service did not respond within ${timeoutMs}ms`);
      }

      log.error('YOLO service error:', (error as Error).message);
      throw new YoloError('unavailable', 'YOLO service is not reachable');
    }

    if (!response.ok) {
      log.error(`YOLO service responded with ${response.status}`);

      // A rejected shared secret and an unreachable process are different
      // problems, and telling someone to check that a running service is
      // running wastes their time.
      const kind: YoloFailureKind =
        response.status === 401 || response.status === 403 || response.status === 503
          ? 'rejected'
          : 'unavailable';

      throw new YoloError(kind, `Python service responded with ${response.status}`);
    }

    try {
      return await response.json();
    } catch (error) {
      // Headers can arrive long before the body does. A deadline that fires
      // while a few hundred keyframes are still streaming, or a proxy that
      // answers 200 with an HTML error page, fails here rather than above, and
      // it is still a proxy failure: without this the admin gets a generic 500
      // instead of the advice to try a shorter clip.
      const name = (error as Error).name;
      const kind: YoloFailureKind =
        name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable';

      log.error('YOLO service sent an unreadable reply:', (error as Error).message);
      throw new YoloError(kind, 'YOLO service sent an unreadable reply');
    }
  }
}

/** Read a JSON object out of a model reply, fenced or not. */
function parseJsonBlock(content: string): Record<string, unknown> | null {
  try {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);

    return JSON.parse(fenced?.[1]?.trim() || content.trim());
  } catch {
    return null;
  }
}

export const cctvService = new CctvService();
