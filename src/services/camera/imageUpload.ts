import type { CapturedImage } from '../../types/camera';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}

function readDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

/** Turns a user-selected file into a local preview. Nothing is sent until the user asks an AI feature to use it. */
export async function imageFromFile(file: File): Promise<CapturedImage> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new ImageUploadError('Please choose a photo file such as JPEG, PNG or WebP.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError('That photo is larger than 15 MB. Please choose a smaller one.');
  }
  const previewUrl = URL.createObjectURL(file);
  const { width, height } = await readDimensions(previewUrl);
  return { blob: file, previewUrl, width, height, capturedAt: new Date().toISOString(), source: 'upload' };
}
