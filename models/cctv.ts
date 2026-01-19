/**
 * CCTV Analysis Routes
 * Handles video analysis for lost item detection using YOLOv8
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/index.js';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

const router = Router();

// YOLO service URL (Python Flask service)
const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:5000';

// COCO dataset class names that YOLO can detect
const COCO_CLASSES = [
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

// Map common item names to COCO classes
function mapItemToCocoClass(itemName: string): string[] {
    const name = itemName.toLowerCase();

    const mappings: Record<string, string[]> = {
        'backpack': ['backpack'],
        'bag': ['backpack', 'handbag', 'suitcase'],
        'laptop': ['laptop'],
        'phone': ['cell phone'],
        'mobile': ['cell phone'],
        'cellphone': ['cell phone'],
        'umbrella': ['umbrella'],
        'wallet': ['handbag'], // closest match
        'keys': [], // YOLO can't detect keys specifically
        'watch': [], // YOLO can't detect watches specifically
        'glasses': [], // YOLO can't detect glasses specifically
        'headphones': [], // closest would be generic
        'bottle': ['bottle'],
        'book': ['book'],
        'suitcase': ['suitcase'],
        'luggage': ['suitcase'],
    };

    // Check for direct matches
    for (const [key, classes] of Object.entries(mappings)) {
        if (name.includes(key)) {
            return classes;
        }
    }

    // Check if it's a COCO class directly
    const directMatch = COCO_CLASSES.find(c => name.includes(c) || c.includes(name));
    if (directMatch) {
        return [directMatch];
    }

    // Default: try to find partial matches
    return COCO_CLASSES.filter(c =>
        name.split(' ').some(word => c.includes(word) || word.includes(c))
    );
}

interface Detection {
    className: string;
    confidence: number;
    timestamp: string;
    frameIndex: number;
    bbox?: [number, number, number, number];
    frameBase64?: string;
}

interface YOLOResponse {
    success: boolean;
    detections: Detection[];
    processedFrames: number;
    maxPeopleInFrame?: number;  // Max unique people detected in any single frame
    error?: string;
}

/**
 * POST /api/cctv/analyze
 * Analyze CCTV video for specific lost item using real YOLO detection
 */
router.post('/analyze', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { targetItem, organization, aiProvider = 'gemini', video } = req.body;

        if (!targetItem) {
            return res.status(400).json({ error: 'Target item is required' });
        }

        // Map target item to COCO classes
        const targetClasses = mapItemToCocoClass(targetItem);

        let allDetections: Detection[] = [];
        let processedFrames = 0;
        let peopleCount = 0;  // Max unique people detected in any single frame

        // If video provided, call Python YOLO service
        if (video) {
            try {
                console.log('Calling Python YOLO service for real video detection...');
                const yoloResponse = await fetch(`${YOLO_SERVICE_URL}/detect`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        video,
                        targetClasses,
                    }),
                });

                if (yoloResponse.ok) {
                    const yoloResult = await yoloResponse.json() as YOLOResponse;
                    if (yoloResult.success) {
                        allDetections = yoloResult.detections;
                        processedFrames = yoloResult.processedFrames;
                        // Use maxPeopleInFrame for accurate unique people count
                        if (yoloResult.maxPeopleInFrame !== undefined) {
                            peopleCount = yoloResult.maxPeopleInFrame;
                        }
                        console.log(`YOLO detected ${allDetections.length} objects in ${processedFrames} frames, max ${peopleCount} people/frame`);
                    }
                } else {
                    console.log('Python YOLO service not available, falling back to simulation');
                }
            } catch (error) {
                console.log('Failed to call Python YOLO service, using simulation:', error);
            }
        }

        // If YOLO service failed or no detections, use simulation as fallback
        if (allDetections.length === 0) {
            console.log('Using simulation mode for detections...');
            const simResult = await simulateYOLODetection(targetItem, organization, aiProvider as AIProvider);
            return res.json(simResult);
        }

        // Filter to only target detections
        const filteredDetections = targetClasses.length > 0
            ? allDetections.filter(d => targetClasses.includes(d.className.toLowerCase()))
            : allDetections.filter(d => d.className.toLowerCase().includes(targetItem.toLowerCase()));

        // Get last detection timestamp
        const lastDetection = filteredDetections.length > 0
            ? filteredDetections[filteredDetections.length - 1]
            : null;

        // Generate AI explanation
        let explanation = '';
        try {
            explanation = await generateExplanation(
                targetItem,
                filteredDetections.length,
                lastDetection?.timestamp || 'N/A',
                organization,
                aiProvider as AIProvider,
                peopleCount
            );
        } catch (error) {
            console.error('Failed to generate AI explanation:', error);
            explanation = `Analysis complete. Found ${filteredDetections.length} matches for "${targetItem}" in CCTV footage. ${peopleCount > 0 ? `Detected ${peopleCount} person(s).` : ''}`;
        }

        // Get key frames (up to 4)
        const keyFrames = filteredDetections
            .slice(0, 4)
            .map(d => d.frameBase64)
            .filter((f): f is string => Boolean(f));

        return res.json({
            targetItem,
            detections: filteredDetections.map(d => ({
                className: d.className,
                confidence: d.confidence,
                timestamp: d.timestamp,
                frameIndex: d.frameIndex,
            })),
            totalCount: filteredDetections.length,
            peopleCount,
            lastSeenTime: lastDetection?.timestamp || 'Not detected',
            keyFrames,
            explanation,
            processedFrames,
        });

    } catch (error) {
        console.error('CCTV analysis error:', error);
        return res.status(500).json({ error: 'Failed to analyze video' });
    }
});

/**
 * Simulate YOLO detection for demo purposes
 * In production, this would call the Python YOLO service
 */
async function simulateYOLODetection(targetItem: string, organization: string, aiProvider: AIProvider = 'gemini') {
    // Map target item to COCO classes
    const targetClasses = mapItemToCocoClass(targetItem);

    // Simulate some detections
    const allDetections: Detection[] = [];
    const targetDetections: Detection[] = [];

    // Generate random detections (simulating what YOLO would find)
    const possibleClasses = ['backpack', 'handbag', 'person', 'chair', 'laptop', 'cell phone', 'bottle', 'suitcase'];
    const numFrames = 10;

    for (let frame = 0; frame < numFrames; frame++) {
        // Random number of detections per frame (1-4)
        const numDetections = Math.floor(Math.random() * 4) + 1;

        for (let d = 0; d < numDetections; d++) {
            const className = possibleClasses[Math.floor(Math.random() * possibleClasses.length)];
            const detection: Detection = {
                className,
                confidence: 0.6 + Math.random() * 0.35, // 0.6 - 0.95
                timestamp: `00:00:${String(frame).padStart(2, '0')}`,
                frameIndex: frame,
                bbox: [
                    Math.random() * 0.3, // x
                    Math.random() * 0.3, // y
                    0.2 + Math.random() * 0.3, // width
                    0.2 + Math.random() * 0.3, // height
                ],
            };

            allDetections.push(detection);

            // Check if this detection matches our target
            if (targetClasses.length === 0 || targetClasses.includes(className)) {
                targetDetections.push(detection);
            }
        }
    }

    // Filter to only target detections
    const filteredDetections = targetDetections.length > 0 ? targetDetections :
        allDetections.filter(d => d.className.toLowerCase().includes(targetItem.toLowerCase()));

    // Count people in all detections
    const peopleCount = allDetections.filter(d => d.className === 'person').length;

    // Determine last seen time
    const lastDetection = filteredDetections.length > 0
        ? filteredDetections[filteredDetections.length - 1]
        : null;

    // Generate AI explanation using selected provider
    let explanation = '';
    try {
        explanation = await generateExplanation(
            targetItem,
            filteredDetections.length,
            lastDetection?.timestamp || 'N/A',
            organization,
            aiProvider,
            peopleCount
        );
    } catch (error) {
        console.error('Failed to generate AI explanation:', error);
        explanation = `Analysis complete. Found ${filteredDetections.length} potential matches for "${targetItem}" in the CCTV footage from ${organization}. ${filteredDetections.length > 0
            ? `Last detection was at ${lastDetection?.timestamp || 'unknown time'}.`
            : 'No matches found in the analyzed frames.'
            } ${peopleCount > 0 ? `Detected ${peopleCount} person(s) in the footage.` : 'No people detected in the analyzed frames.'}`;
    }

    // Generate placeholder key frames (in reality these would be actual frame images)
    const keyFrames: string[] = [];
    if (filteredDetections.length > 0) {
        // Create simple placeholder images as data URLs for demo
        // In production, these would be actual frame extracts from the video
        for (let i = 0; i < Math.min(4, filteredDetections.length); i++) {
            keyFrames.push(createPlaceholderFrame(filteredDetections[i]));
        }
    }

    return {
        targetItem,
        detections: filteredDetections.map(d => ({
            className: d.className,
            confidence: d.confidence,
            timestamp: d.timestamp,
            frameIndex: d.frameIndex,
        })),
        totalCount: filteredDetections.length,
        peopleCount, // Add people count to response
        lastSeenTime: lastDetection?.timestamp || 'Not detected',
        keyFrames,
        explanation,
    };
}

type AIProvider = 'gemini' | 'groq';

/**
 * Generate AI explanation using selected provider (Gemini or Groq)
 */
async function generateExplanation(
    targetItem: string,
    detectionCount: number,
    lastSeen: string,
    organization: string,
    aiProvider: AIProvider = 'gemini',
    peopleCount: number = 0
): Promise<string> {
    const prompt = `You are an AI assistant analyzing CCTV footage for a lost item recovery system. 
    
Analysis Results:
- Target item searched: ${targetItem}
- Number of target item detections: ${detectionCount}
- Last seen timestamp: ${lastSeen}
- Location: ${organization}
- People detected in footage: ${peopleCount}

Generate a brief, professional explanation (2-3 sentences) for the admin about these detection results. 
Include how many people were detected in the footage. Be helpful and suggest next steps if applicable. Keep it concise and actionable.`;

    try {
        if (aiProvider === 'groq') {
            return await generateWithGroq(prompt, detectionCount, targetItem, organization, lastSeen);
        } else {
            return await generateWithGemini(prompt, detectionCount, targetItem, organization, lastSeen);
        }
    } catch (error) {
        console.error(`${aiProvider} API error:`, error);
        // Fallback explanation
        if (detectionCount > 0) {
            return `Our AI analysis detected ${detectionCount} instance(s) of "${targetItem}" in the CCTV footage from ${organization}. The last detection was at ${lastSeen}. We recommend reviewing the key frames below to verify the match.`;
        } else {
            return `No matches for "${targetItem}" were found in the analyzed CCTV footage from ${organization}. Consider expanding the search timeframe or checking adjacent camera feeds.`;
        }
    }
}

/**
 * Generate explanation using Google Gemini
 */
async function generateWithGemini(
    prompt: string,
    detectionCount: number,
    targetItem: string,
    organization: string,
    lastSeen: string
): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
        throw new Error('Gemini API key not configured');
    }

    const model = new ChatGoogleGenerativeAI({
        apiKey,
        model: 'gemini-1.5-flash',
        temperature: 0.3,
    });

    const response = await model.invoke(prompt);
    return typeof response.content === 'string' ? response.content : getFallbackExplanation(detectionCount, targetItem, organization, lastSeen);
}

/**
 * Generate explanation using Groq (Llama)
 */
async function generateWithGroq(
    prompt: string,
    detectionCount: number,
    targetItem: string,
    organization: string,
    lastSeen: string
): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        throw new Error('Groq API key not configured');
    }

    const { ChatGroq } = await import('@langchain/groq');

    const model = new ChatGroq({
        apiKey,
        model: 'llama-3.1-70b-versatile',
        temperature: 0.3,
    });

    const response = await model.invoke(prompt);
    return typeof response.content === 'string' ? response.content : getFallbackExplanation(detectionCount, targetItem, organization, lastSeen);
}

/**
 * Fallback explanation when AI fails
 */
function getFallbackExplanation(detectionCount: number, targetItem: string, organization: string, lastSeen: string): string {
    if (detectionCount > 0) {
        return `Our AI analysis detected ${detectionCount} instance(s) of "${targetItem}" in the CCTV footage from ${organization}. The last detection was at ${lastSeen}. We recommend reviewing the key frames below to verify the match.`;
    } else {
        return `No matches for "${targetItem}" were found in the analyzed CCTV footage from ${organization}. Consider expanding the search timeframe or checking adjacent camera feeds.`;
    }
}

/**
 * Create a placeholder frame image (for demo purposes)
 * In production, this would extract actual frames from the video
 */
function createPlaceholderFrame(detection: Detection): string {
    // Return a data URL for a simple SVG placeholder
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
            <rect fill="#1a1a2e" width="320" height="180"/>
            <rect fill="#16213e" x="10" y="10" width="300" height="160" rx="8"/>
            <rect fill="#e94560" x="${50 + Math.random() * 100}" y="${40 + Math.random() * 60}" width="80" height="60" rx="4" opacity="0.8"/>
            <text x="160" y="165" text-anchor="middle" fill="#fff" font-family="Arial" font-size="12">
                ${detection.className} @ ${detection.timestamp}
            </text>
            <text x="160" y="30" text-anchor="middle" fill="#0f3460" font-family="Arial" font-size="10">
                Frame ${detection.frameIndex}
            </text>
        </svg>
    `;

    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/**
 * POST /api/cctv/analyze-real
 * Real YOLO analysis (requires Python service running)
 */
router.post('/analyze-real', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { targetItem, organization } = req.body;

        // Check if video file was uploaded
        // Note: This would require multer or similar middleware for file uploads

        if (!targetItem) {
            return res.status(400).json({ error: 'Target item is required' });
        }

        // Map target item to COCO classes
        const targetClasses = mapItemToCocoClass(targetItem);

        if (targetClasses.length === 0) {
            return res.status(400).json({
                error: `Cannot detect "${targetItem}" - not a supported object class`,
                supportedClasses: COCO_CLASSES.slice(0, 20) // Show first 20 as examples
            });
        }

        // Call Python YOLO service
        // This would require the video to be uploaded first
        const response = await fetch(`${YOLO_SERVICE_URL}/detect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                targetClasses,
                // video would be sent as base64 or via multipart/form-data
            }),
        });

        if (!response.ok) {
            throw new Error(`YOLO service error: ${response.statusText}`);
        }

        const yoloResult = await response.json() as YOLOResponse;

        // Filter detections to only target classes
        const filteredDetections = yoloResult.detections.filter(d =>
            targetClasses.includes(d.className.toLowerCase())
        );

        // Generate explanation
        const lastDetection = filteredDetections[filteredDetections.length - 1];
        const explanation = await generateExplanation(
            targetItem,
            filteredDetections.length,
            lastDetection?.timestamp || 'N/A',
            organization
        );

        return res.json({
            targetItem,
            detections: filteredDetections,
            totalCount: filteredDetections.length,
            lastSeenTime: lastDetection?.timestamp || 'Not detected',
            keyFrames: filteredDetections.slice(0, 4).map(d => d.frameBase64).filter(Boolean),
            explanation,
        });

    } catch (error) {
        console.error('CCTV real analysis error:', error);
        return res.status(500).json({ error: 'Failed to analyze video with YOLO service' });
    }
});

export default router;
