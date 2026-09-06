import { authGet, authPost } from '@/lib/api';

// Detection types
export interface Detection {
  className: string;
  confidence: number;
  bbox: [number, number, number, number];
  croppedImage?: string;
}

export interface DetectionResult {
  success: boolean;
  detections: Detection[];
  count: number;
  error?: string;
}

// Detect objects in a base64 image frame
export async function detectObjectsInFrame(
  imageBase64: string,
  targetClasses?: string[],
  targetClass?: string,
): Promise<DetectionResult> {
  return authPost<DetectionResult>('/api/cctv/detect', {
    image: imageBase64,
    targetClasses,
    targetClass,
  });
}

// Get all available YOLO class names for dropdown
export async function getYoloClasses(): Promise<string[]> {
  const data = await authGet<{ classes?: string[] }>('/api/cctv/classes');
  return data.classes || [];
}

// AI item description types
export interface ItemDescription {
  success: boolean;
  name: string;
  description: string;
  category: string;
  tags: string[];
  color: string;
}

// Get AI-generated description for detected item
export async function describeItemImage(
  imageBase64: string,
  detectedClass: string,
): Promise<ItemDescription> {
  return authPost<ItemDescription>('/api/cctv/describe', {
    image: imageBase64,
    detectedClass,
  });
}

// Capture frame from video element as base64
export function captureFrame(videoElement: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  }
  return '';
}

// Common object classes for lost items
export const COMMON_LOST_CLASSES = [
  'backpack',
  'handbag',
  'suitcase',
  'cell phone',
  'laptop',
  'mouse',
  'keyboard',
  'book',
  'bottle',
  'umbrella',
  'sports ball',
  'wallet',
  'keys',
  'watch',
];

// Video analysis types
export interface Keyframe {
  timestamp: number;
  frameImage: string;
  confidence: number;
  detections: Detection[];
}

export interface VideoAnalysisStats {
  totalFramesAnalyzed: number;
  framesWithTarget: number;
  averageConfidence: number;
  maxConfidence: number;
}

export interface AIAnalysis {
  matchConfidence: number;
  explanation: string;
  recommendations: string[];
}

export interface VideoAnalysisResult {
  success: boolean;
  keyframes: Keyframe[];
  stats: VideoAnalysisStats;
  aiAnalysis: AIAnalysis;
}

export interface FrameData {
  image: string;
  timestamp: number;
}

/**
 * Longest edge a captured frame is scaled to before encoding.
 *
 * A frame is sent as base64 JSON, which is a third larger again than the JPEG.
 * At native resolution a few minutes of footage is comfortably past the
 * server's 10mb body limit, and YOLO does not need the extra pixels to find a
 * backpack on a corridor floor.
 */
const FRAME_MAX_EDGE = 640;
const FRAME_JPEG_QUALITY = 0.6;

/** Budget for one analyze request, under the server's 10mb body limit. */
const ANALYZE_BATCH_BYTES = 6 * 1024 * 1024;

/**
 * Frames the server accepts in one request (`MAX_FRAMES` in the zod schema).
 *
 * The byte budget alone is not enough: downscaled corridor frames encode small
 * enough that 6mb holds several hundred of them, so a long clip would build a
 * batch that is comfortably under the size limit and still rejected outright.
 */
const ANALYZE_BATCH_FRAMES = 300;

/**
 * Split frames into request-sized batches.
 *
 * A single oversized frame still gets its own batch rather than being dropped:
 * one 413 is a better failure than silently analysing less footage than the
 * admin uploaded.
 */
function batchFrames(frames: FrameData[]): FrameData[][] {
  const batches: FrameData[][] = [];
  let current: FrameData[] = [];
  let size = 0;

  for (const frame of frames) {
    const frameSize = frame.image.length;
    const full = current.length >= ANALYZE_BATCH_FRAMES || size + frameSize > ANALYZE_BATCH_BYTES;

    if (current.length > 0 && full) {
      batches.push(current);
      current = [];
      size = 0;
    }

    current.push(frame);
    size += frameSize;
  }

  if (current.length > 0) batches.push(current);

  return batches;
}

// Extract frames from video at specified interval
export function extractFramesFromVideo(
  videoElement: HTMLVideoElement,
  intervalSeconds: number = 1,
): Promise<FrameData[]> {
  return new Promise((resolve) => {
    const frames: FrameData[] = [];
    const duration = videoElement.duration;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx || !duration || duration === Infinity) {
      resolve([]);
      return;
    }

    // Scaled down on capture, keeping the aspect ratio. Encoding at the
    // source resolution is what made a multi-frame analyze request the most
    // likely 413 in the app.
    const sourceWidth = videoElement.videoWidth || 640;
    const sourceHeight = videoElement.videoHeight || 480;
    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(sourceWidth, sourceHeight));

    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    let currentTime = 0;

    const captureNextFrame = () => {
      if (currentTime >= duration) {
        resolve(frames);
        return;
      }
      videoElement.currentTime = currentTime;
    };

    videoElement.onseeked = () => {
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      frames.push({
        image: canvas.toDataURL('image/jpeg', FRAME_JPEG_QUALITY),
        timestamp: currentTime,
      });
      currentTime += intervalSeconds;
      captureNextFrame();
    };

    captureNextFrame();
  });
}

/** One analyze request. */
async function analyzeBatch(
  frames: FrameData[],
  targetClass: string,
  itemName: string,
  itemDescription: string,
): Promise<VideoAnalysisResult> {
  return authPost<VideoAnalysisResult>('/api/cctv/analyze', {
    frames,
    targetClass,
    itemName,
    itemDescription,
  });
}

/**
 * Merge the per-batch results into the one result the page renders.
 *
 * The average is re-weighted by the frames each batch actually matched, rather
 * than averaging the averages, which would let a batch with one hit count for
 * as much as a batch with forty.
 */
function mergeAnalyses(results: VideoAnalysisResult[], failedBatches = 0): VideoAnalysisResult {
  const stats = results.reduce(
    (total, result) => {
      const matched = result.stats?.framesWithTarget ?? 0;

      return {
        totalFramesAnalyzed: total.totalFramesAnalyzed + (result.stats?.totalFramesAnalyzed ?? 0),
        framesWithTarget: total.framesWithTarget + matched,
        confidenceSum: total.confidenceSum + (result.stats?.averageConfidence ?? 0) * matched,
        maxConfidence: Math.max(total.maxConfidence, result.stats?.maxConfidence ?? 0),
      };
    },
    { totalFramesAnalyzed: 0, framesWithTarget: 0, confidenceSum: 0, maxConfidence: 0 },
  );

  // The commentary of the batch that saw the object most clearly. Averaging
  // prose is not a thing, and the most confident batch is the one an admin
  // would look at first. Seeded rather than reduced bare, so an empty list is
  // an empty result instead of a TypeError.
  const best = results.reduce<VideoAnalysisResult | null>(
    (strongest, result) =>
      (result.aiAnalysis?.matchConfidence ?? 0) > (strongest?.aiAnalysis?.matchConfidence ?? -1)
        ? result
        : strongest,
    null,
  );

  const aiAnalysis: AIAnalysis = best?.aiAnalysis ?? {
    matchConfidence: 0,
    explanation: 'No analysis was returned.',
    recommendations: ['Try a shorter clip or a longer frame interval'],
  };

  return {
    success: true,
    keyframes: results
      .flatMap((result) => result.keyframes ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10),
    stats: {
      totalFramesAnalyzed: stats.totalFramesAnalyzed,
      framesWithTarget: stats.framesWithTarget,
      averageConfidence:
        stats.framesWithTarget > 0
          ? Math.round((stats.confidenceSum / stats.framesWithTarget) * 100) / 100
          : 0,
      maxConfidence: stats.maxConfidence,
    },
    // A partial analysis says so. Reporting the surviving batches as the whole
    // result would understate how much footage was actually looked at.
    aiAnalysis:
      failedBatches > 0
        ? {
            ...aiAnalysis,
            explanation: `${aiAnalysis.explanation} (${failedBatches} of ${results.length + failedBatches} segments could not be analysed.)`,
          }
        : aiAnalysis,
  };
}

/**
 * Analyze video for a specific lost item.
 *
 * Sent in batches that fit the server's body limit. A few minutes of footage
 * at one frame every five seconds used to go up as a single request and was
 * the most likely 413 in the app; the frames are smaller now, and anything
 * still too big for one request is split rather than rejected.
 */
export async function analyzeVideoForItem(
  frames: FrameData[],
  targetClass: string,
  itemName: string,
  itemDescription: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<VideoAnalysisResult> {
  const batches = batchFrames(frames);
  const results: VideoAnalysisResult[] = [];
  let lastError: unknown = null;

  // Sequential on purpose: each batch runs YOLO over every frame in it, and
  // firing them all at once is how one admin saturates the detection service.
  for (const [index, batch] of batches.entries()) {
    try {
      results.push(await analyzeBatch(batch, targetClass, itemName, itemDescription));
    } catch (error) {
      // One segment timing out must not throw away the segments that already
      // succeeded: on a slow detection host that is several minutes of work,
      // and the admin has nothing to show for it.
      lastError = error;
    }

    onProgress?.(index + 1, batches.length);
  }

  if (results.length === 0) {
    throw lastError instanceof Error ? lastError : new Error('Video analysis failed');
  }

  const failedBatches = batches.length - results.length;

  if (results.length === 1 && failedBatches === 0) return results[0];

  return mergeAnalyses(results, failedBatches);
}
