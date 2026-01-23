import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/index.js';
import fetch from 'node-fetch';

const router = Router();

// Python YOLO service URL
const YOLO_SERVICE_URL = process.env.YOLO_SERVICE_URL || 'http://localhost:5000';

// GET /api/cctv/classes - Get all YOLO class names for dropdown
router.get('/classes', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const response = await fetch(`${YOLO_SERVICE_URL}/classes`);
        if (!response.ok) throw new Error(`Python service responded with ${response.status}`);
        return res.json(await response.json());
    } catch (connError: any) {
        console.error('YOLO service error:', connError.message);
        return res.status(503).json({
            error: 'YOLO Detection Service unavailable',
            details: 'Please ensure python app.py is running on port 5000'
        });
    }
});

// POST /api/cctv/detect - Proxy to Python YOLO service
router.post('/detect', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { image, targetClasses, targetClass } = req.body;
        if (!image) return res.status(400).json({ error: 'Image data is required' });

        try {
            const response = await fetch(`${YOLO_SERVICE_URL}/detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image, targetClasses, targetClass })
            });

            if (!response.ok) throw new Error(`Python service responded with ${response.status}`);
            return res.json(await response.json());
        } catch (connError: any) {
            console.error('YOLO service error:', connError.message);
            return res.status(503).json({
                error: 'YOLO Detection Service unavailable',
                details: 'Please ensure python app.py is running on port 5000'
            });
        }
    } catch (error: any) {
        console.error('CCTV route error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/cctv/analyze - Video analysis with Groq AI
router.post('/analyze', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { frames, targetClass, itemName, itemDescription } = req.body;
        if (!frames || !Array.isArray(frames) || frames.length === 0) {
            return res.status(400).json({ error: 'Frames array is required' });
        }

        // Call Python YOLO service
        let yoloResult: any;
        try {
            const response = await fetch(`${YOLO_SERVICE_URL}/analyze-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frames, targetClass: targetClass || '', itemName: itemName || '', itemDescription: itemDescription || '' })
            });
            if (!response.ok) throw new Error(`Python service responded with ${response.status}`);
            yoloResult = await response.json();
        } catch (connError: any) {
            console.error('YOLO service error:', connError.message);
            return res.status(503).json({ error: 'YOLO Detection Service unavailable', details: 'Please ensure python app.py is running on port 5000' });
        }

        // Call Groq for AI analysis
        let aiAnalysis = { matchConfidence: yoloResult.stats?.maxConfidence || 0, explanation: '', recommendations: [] as string[] };

        try {
            const groqApiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;
            if (groqApiKey && yoloResult.keyframes?.length > 0) {
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

                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                        messages: [
                            { role: 'system', content: 'You are an AI assistant that analyzes object detection results. Always respond with valid JSON.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.3,
                        max_tokens: 512
                    })
                });

                if (groqResponse.ok) {
                    const groqData = await groqResponse.json() as { choices?: { message?: { content?: string } }[] };
                    const content = groqData.choices?.[0]?.message?.content || '';
                    try {
                        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
                        const parsed = JSON.parse(jsonMatch[1]?.trim() || content.trim());
                        aiAnalysis = {
                            matchConfidence: parsed.matchConfidence || yoloResult.stats.maxConfidence,
                            explanation: parsed.explanation || 'AI analysis completed.',
                            recommendations: parsed.recommendations || []
                        };
                    } catch {
                        aiAnalysis.explanation = 'Detection analysis completed. Visual verification recommended.';
                        aiAnalysis.recommendations = ['Verify object visually', 'Check distinguishing features'];
                    }
                }
            } else {
                aiAnalysis.explanation = yoloResult.keyframes?.length > 0
                    ? 'Object detected. Groq AI not configured.'
                    : 'No matching objects found.';
                aiAnalysis.recommendations = yoloResult.keyframes?.length > 0
                    ? ['Review keyframes manually']
                    : ['Try uploading a different video'];
            }
        } catch (aiError: any) {
            console.error('Groq AI error:', aiError.message);
            aiAnalysis.explanation = 'AI analysis unavailable. Manual review recommended.';
        }

        return res.json({ success: true, keyframes: yoloResult.keyframes || [], stats: yoloResult.stats || {}, aiAnalysis });
    } catch (error: any) {
        console.error('CCTV analyze error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /api/cctv/describe - AI image description
router.post('/describe', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { image, detectedClass } = req.body;
        if (!image) return res.status(400).json({ error: 'Image data is required' });

        const groqApiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;
        const defaultResponse = {
            success: true,
            name: `Found ${detectedClass || 'Item'}`,
            description: `Item detected via CCTV. Object identified as ${detectedClass || 'unknown'}.`,
            category: detectedClass || 'Other',
            tags: [detectedClass?.toLowerCase() || 'item', 'found', 'cctv'],
            color: 'Unknown'
        };

        if (!groqApiKey) return res.json(defaultResponse);

        const imageData = image.includes(',') ? image.split(',')[1] : image;
        const prompt = `Analyze this found item image (detected as "${detectedClass || 'unknown'}"). Respond in JSON:
{
  "name": "Descriptive name",
  "description": "Detailed description",
  "category": "Electronics/Bags/Clothing/Accessories/Documents/Keys/Wallet/Sports/Books/Other",
  "tags": ["tag1", "tag2"],
  "color": "Primary color"
}`;

        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                messages: [
                    { role: 'system', content: 'Analyze found item images. Respond with valid JSON.' },
                    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageData}` } }] }
                ],
                temperature: 0.3,
                max_tokens: 512
            })
        });

        if (!groqResponse.ok) {
            console.error('Groq API error');
            return res.json(defaultResponse);
        }

        const groqData = await groqResponse.json() as { choices?: { message?: { content?: string } }[] };
        const content = groqData.choices?.[0]?.message?.content || '';

        try {
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
            const parsed = JSON.parse(jsonMatch[1]?.trim() || content.trim());
            return res.json({
                success: true,
                name: parsed.name || defaultResponse.name,
                description: parsed.description || defaultResponse.description,
                category: parsed.category || detectedClass || 'Other',
                tags: parsed.tags || [detectedClass?.toLowerCase() || 'item'],
                color: parsed.color || 'Unknown'
            });
        } catch {
            return res.json(defaultResponse);
        }
    } catch (error: any) {
        console.error('CCTV describe error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
