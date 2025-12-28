/**
 * Cloudinary Service - Image upload and management
 */

import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
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
    folder: string = 'reclaim-items'
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
        console.error('Cloudinary upload error:', error);
        throw new Error('Failed to upload image');
    }
}

/**
 * Upload multiple images
 */
export async function uploadMultipleImages(
    images: string[],
    folder: string = 'reclaim-items'
): Promise<UploadResult[]> {
    const results = await Promise.all(
        images.map(img => uploadImage(img, folder))
    );
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
        console.error('Cloudinary delete error:', error);
        return false;
    }
}

/**
 * Get optimized URL for an image
 */
export function getOptimizedUrl(
    publicId: string,
    options: { width?: number; height?: number; quality?: string } = {}
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
    return !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}
