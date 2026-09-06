/**
 * Client-side image compression.
 *
 * Every image the app sends travels as a base64 data URL inside a JSON body,
 * which is a third larger again than the bytes it encodes, against a 10 MB
 * limit on the server. An ordinary phone photo is several megabytes on its
 * own, so a report with a few of them was a 413 that the UI reported as a
 * generic failure (defect UI-15). Compressing at the point of selection means
 * analysis and submission both send the small version.
 */

/** Longest edge a compressed image is scaled to. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

/**
 * Refuse a source file this large before spending time decoding it. Set above
 * what a camera produces: the cap is there to stop an absurd file from hanging
 * the tab, not to turn away a real photo.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Budget for the base64 payload of one request, under the server's 10 MB limit. */
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Whether the file is worth trying to decode.
 *
 * Deliberately permissive: a browser that can draw the format onto a canvas is
 * the real test, and one that cannot fails with a per-file message. A file with
 * no type at all is given the benefit of the doubt.
 */
export function isImageFile(file: File): boolean {
  return !file.type || file.type.startsWith('image/');
}

export interface CompressedImage {
  /** The compressed image as a File, for the endpoints that take files. */
  file: File;
  /** The same image as a data URL, used as both preview and upload payload. */
  dataUrl: string;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file could not be read as an image'));
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('The file could not be read'));
    reader.readAsDataURL(file);
  });
}

function scaledSize(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const ratio = maxEdge / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/**
 * Scale an image down to `maxEdge` and re-encode it as JPEG.
 *
 * Returns both forms because the two callers need different ones: image
 * analysis posts files, item creation posts data URLs, and re-encoding twice
 * for that would be wasted work.
 */
export async function compressImage(file: File, maxEdge = MAX_EDGE): Promise<CompressedImage> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('This image is too large. Please pick one under 25 MB.');
  }

  const sourceDataUrl = await readAsDataUrl(file);
  const img = await loadImage(sourceDataUrl);
  const { width, height } = scaledSize(img.width, img.height, maxEdge);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not process the image');

  // JPEG has no alpha channel, and an unpainted canvas is transparent black,
  // so a PNG or WebP with transparency would encode onto a black background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const compressed = new File([dataUrlToBlob(dataUrl)], toJpegName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });

  return { file: compressed, dataUrl };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function toJpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.jpg`;
}

/** Bytes a set of data URLs occupies in a JSON body. */
export function payloadBytes(dataUrls: string[]): number {
  return dataUrls.reduce((total, dataUrl) => total + dataUrl.length, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
