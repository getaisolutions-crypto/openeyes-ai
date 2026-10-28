import { AIRequestError } from '../../types/ai';
import type { CapturedImage } from '../../types/camera';
import { AI_ERROR_MESSAGES } from './openEyesBackend';

export const AI_IMAGE_LIMITS = {
  /** Longest edge after resizing. Enough detail for text and objects, small enough to upload quickly. */
  maxDimension: 1280,
  jpegQuality: 0.8,
  maxSourceBytes: 15 * 1024 * 1024,
  maxEncodedBytes: 4 * 1024 * 1024,
  acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
} as const;

/** Converts a photo into a compressed JPEG data URL ready to send to the server. */
export type ImageEncoder = (image: CapturedImage) => Promise<string>;

function fail(kind: 'unsupported-image' | 'image-too-large'): never {
  throw new AIRequestError(kind, AI_ERROR_MESSAGES[kind]);
}

export function validateImageForAI(image: CapturedImage): void {
  if (!(AI_IMAGE_LIMITS.acceptedTypes as readonly string[]).includes(image.blob.type)) fail('unsupported-image');
  if (image.blob.size > AI_IMAGE_LIMITS.maxSourceBytes) fail('image-too-large');
}

export function scaleToFit(width: number, height: number, max: number = AI_IMAGE_LIMITS.maxDimension) {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Approximate decoded size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

async function decode(image: CapturedImage): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(image.blob);
    } catch {
      fail('unsupported-image');
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight }));
    img.onerror = () => reject(new AIRequestError('unsupported-image', AI_ERROR_MESSAGES['unsupported-image']));
    img.src = image.previewUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new AIRequestError('unsupported-image', AI_ERROR_MESSAGES['unsupported-image']));
    reader.readAsDataURL(blob);
  });
}

/** Resizes to at most 1280 px on the longest edge and re-encodes as JPEG in the browser. */
export const encodeImageForAI: ImageEncoder = async (image) => {
  validateImageForAI(image);
  const source = await decode(image);
  const size = scaleToFit(source.width, source.height);
  if (!size.width) fail('unsupported-image');

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) fail('unsupported-image');
  context.drawImage(source, 0, 0, size.width, size.height);
  if ('close' in source && typeof source.close === 'function') source.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', AI_IMAGE_LIMITS.jpegQuality),
  );
  if (!blob) fail('unsupported-image');
  const dataUrl = await blobToDataUrl(blob);
  if (dataUrlBytes(dataUrl) > AI_IMAGE_LIMITS.maxEncodedBytes) fail('image-too-large');
  return dataUrl;
};
