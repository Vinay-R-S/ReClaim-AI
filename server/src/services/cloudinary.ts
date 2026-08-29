/**
 * Cloudinary Service - Image upload and management
 */

import { v2 as cloudinary } from 'cloudinary';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const log = createLogger('cloudinary');

// Configure Cloudinary
cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
});

export interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/**
 * Upload an image to Cloudinary
 * @param imageData - Base64 encoded image or file path
 * @param folder - Folder to store the image
 * @returns Upload result with URL and metadata
 */
export async function uploadImage(
  imageData: string,
  folder: string = 'reclaim-items',
): Promise<UploadResult> {
  try {
    // Add data URI prefix if not present
    let uploadData = imageData;
    if (!imageData.startsWith('data:') && !imageData.startsWith('http')) {
      uploadData = `data:image/jpeg;base64,${imageData}`;
    }

    const result = await cloudinary.uploader.upload(uploadData, {
      folder,
      resource_type: 'image',
      transformation: [
        { width: 800, height: 800, crop: 'limit' }, // Max dimensions
        { quality: 'auto:good' }, // Auto quality optimization
        { fetch_format: 'auto' }, // Auto format (webp when supported)
      ],
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  } catch (error) {
    log.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image');
  }
}

/**
 * Upload multiple images
 */
export async function uploadMultipleImages(
  images: string[],
  folder: string = 'reclaim-items',
): Promise<UploadResult[]> {
  const results = await Promise.all(images.map((img) => uploadImage(img, folder)));
  return results;
}

/**
 * Delete an image from Cloudinary
 */
export async function deleteImage(publicId: string): Promise<boolean> {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === 'ok';
  } catch (error) {
    log.error('Cloudinary delete error:', error);
    return false;
  }
}

/**
 * Get optimized URL for an image
 */
export function getOptimizedUrl(
  publicId: string,
  options: { width?: number; height?: number; quality?: string } = {},
): string {
  const { width = 400, height = 400, quality = 'auto:good' } = options;

  return cloudinary.url(publicId, {
    width,
    height,
    crop: 'fill',
    quality,
    fetch_format: 'auto',
  });
}

/**
 * Check if Cloudinary is configured
 */
export function isCloudinaryConfigured(): boolean {
  return !!env.cloudinary.isConfigured;
}
