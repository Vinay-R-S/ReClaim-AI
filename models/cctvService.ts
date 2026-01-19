/**
 * CCTV Analysis Service
 * Handles video analysis for lost item detection using real YOLO
 */

import { authFetch } from "@/lib/authApi";

export interface Detection {
    className: string;
    confidence: number;
    timestamp: string;
    frameIndex: number;
    bbox?: [number, number, number, number];
}

export interface CCTVAnalysisResult {
    targetItem: string;
    detections: Detection[];
    totalCount: number;
    peopleCount: number;
    lastSeenTime: string;
    keyFrames: string[];
    explanation: string;
    processedFrames?: number;
}

// AI Provider options
export type AIProvider = 'gemini' | 'groq';

// COCO dataset classes that YOLOv8 can detect
export const COCO_CLASSES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
    'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
    'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
    'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
    'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
    'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
    'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
    'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

/**
 * Convert file to base64 for sending to backend
 */
async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
}

/**
 * Analyze CCTV video for specific lost item using real YOLO detection
 */
export async function analyzeCCTV(
    videoFile: File,
    targetItem: string,
    organization: string,
    aiProvider: AIProvider = 'gemini'
): Promise<CCTVAnalysisResult> {
    // Convert video to base64 for transmission
    const videoBase64 = await fileToBase64(videoFile);

    const response = await authFetch("/api/cctv/analyze", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            targetItem,
            organization,
            aiProvider,
            video: videoBase64,  // Send actual video for real YOLO detection
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Analysis failed" }));
        throw new Error(error.error || "Failed to analyze video");
    }

    return response.json();
}
