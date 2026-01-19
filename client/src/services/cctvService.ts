import { authFetch } from "@/lib/authApi";

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
export async function detectObjectsInFrame(imageBase64: string, targetClasses?: string[]): Promise<DetectionResult> {
    const response = await authFetch("/api/cctv/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64, targetClasses }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.details || err.error || "Detection failed");
    }
    return response.json();
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
export async function describeItemImage(imageBase64: string, detectedClass: string): Promise<ItemDescription> {
    const response = await authFetch("/api/cctv/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageBase64, detectedClass }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.details || err.error || "Description failed");
    }
    return response.json();
}

// Capture frame from video element as base64
export function captureFrame(videoElement: HTMLVideoElement): string {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.8);
    }
    return "";
}

// Common object classes for lost items
export const COMMON_LOST_CLASSES = [
    'backpack', 'handbag', 'suitcase', 'cell phone', 'laptop',
    'mouse', 'keyboard', 'book', 'bottle', 'umbrella', 'sports ball',
    'wallet', 'keys', 'watch'
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

// Extract frames from video at specified interval
export function extractFramesFromVideo(videoElement: HTMLVideoElement, intervalSeconds: number = 1): Promise<FrameData[]> {
    return new Promise((resolve) => {
        const frames: FrameData[] = [];
        const duration = videoElement.duration;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx || !duration || duration === Infinity) {
            resolve([]);
            return;
        }

        canvas.width = videoElement.videoWidth || 640;
        canvas.height = videoElement.videoHeight || 480;
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
            frames.push({ image: canvas.toDataURL("image/jpeg", 0.7), timestamp: currentTime });
            currentTime += intervalSeconds;
            captureNextFrame();
        };

        captureNextFrame();
    });
}

// Analyze video for a specific lost item
export async function analyzeVideoForItem(frames: FrameData[], targetClass: string, itemName: string, itemDescription: string): Promise<VideoAnalysisResult> {
    const response = await authFetch("/api/cctv/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frames, targetClass, itemName, itemDescription }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.details || err.error || "Video analysis failed");
    }
    return response.json();
}
