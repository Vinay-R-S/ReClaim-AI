// AI service for item analysis
//
// Every model call goes through the server. The browser holds no provider key:
// a VITE_* key is inlined into the bundle and readable by anyone who loads the
// site (defect SEC-16). Which provider actually runs is the admin `aiProvider`
// setting, applied server side.

import { authGet, authPost } from '../lib/api';

export interface AnalysisResult {
  name: string;
  description: string;
  tags: string[];
  color: string;
  category: string;
}

const EMPTY_ANALYSIS: AnalysisResult = {
  name: 'Unknown Item',
  description: 'AI analysis failed. Please add details manually.',
  tags: [],
  color: '',
  category: 'Other',
};

// Convert File to base64
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:image/...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}

async function toPayload(files: File[]): Promise<{ base64: string; mimeType: string }[]> {
  return Promise.all(
    files.map(async (file) => ({
      base64: await fileToBase64(file),
      mimeType: file.type || 'image/jpeg',
    })),
  );
}

/**
 * Analyze one or more images of the same item
 */
export async function analyzeItemImages(files: File[]): Promise<AnalysisResult> {
  if (files.length === 0) {
    return { ...EMPTY_ANALYSIS, description: 'No images provided for analysis.' };
  }

  const images = await toPayload(files.slice(0, 5));
  return authPost<AnalysisResult>('/api/ai/analyze-image', { images });
}

/**
 * Single-image analysis, kept for the callers that only ever have one file
 */
export async function analyzeItemImage(file: File): Promise<AnalysisResult> {
  return analyzeItemImages([file]);
}

/**
 * Improve a typed report that has no image
 */
export async function enhanceTextDescription(
  name: string,
  description: string,
): Promise<AnalysisResult> {
  try {
    return await authPost<AnalysisResult>('/api/ai/enhance-description', { name, description });
  } catch (err) {
    console.error('Text enhancement failed:', err);
    // Enhancement is a convenience; never lose what the user typed.
    return { name, description, tags: [], color: '', category: 'Other' };
  }
}

/**
 * Whether the server has any provider configured
 */
export async function isAiAvailable(): Promise<boolean> {
  try {
    const { available } = await authGet<{ available: boolean }>('/api/ai/status');
    return available;
  } catch {
    return false;
  }
}
