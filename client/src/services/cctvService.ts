
import { authFetch } from "@/lib/authApi";

export interface Detection {
    className: string;
    confidence: number;
    bbox: [number, number, number, number]; // [x1, y1, x2, y2]
    croppedImage?: string; // Base64 of the object
}

export interface DetectionResult {
    success: boolean;
    detections: Detection[];
    count: number;
    error?: string;
}

/**
 * Detect objects in a base64 image frame
 */
export async function detectObjectsInFrame(
    imageBase64: string,
    targetClasses?: string[]
): Promise<DetectionResult> {
    const response = await authFetch("/api/cctv/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            image: imageBase64,
            targetClasses
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.details || err.error || "Detection failed");
    }

    return response.json();
}

/**
 * Helper to capture frame from video element
 */
export function captureFrame(videoElement: HTMLVideoElement): string {
    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.8); // 80% quality jpeg
    }
    return "";
}

/**
 * Common object classes for lost items
 */
export const COMMON_LOST_CLASSES = [
    'backpack', 'handbag', 'suitcase', 'cell phone', 'laptop',
    'mouse', 'keyboard', 'book', 'bottle', 'umbrella', 'sports ball',
    'wallet', 'keys', 'watch' // Note: YOLO standard might not have all, depends on model
];
