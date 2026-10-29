import {
  ProviderUnavailableError,
  type AIProvider,
  type ObjectDetectionProvider,
  type ProviderStatus,
  type VisionProvider,
} from '../../types/ai';

/**
 * Used when the app has no OpenEyes server address configured. They never produce responses;
 * every call rejects with a clear explanation.
 */

export const AI_NOT_CONNECTED =
  'The Meta AI connection is not set up yet, so OpenEyes cannot answer. Nothing was sent anywhere.';
export const VISION_NOT_CONNECTED =
  'Image understanding is not available yet. The photo stayed on your device and was not sent anywhere.';
export const DETECTION_NOT_CONNECTED =
  'Object detection is not available yet. The photo stayed on your device and was not sent anywhere.';

const unavailable = (reason: string): ProviderStatus => ({ available: false, reason });

export function createUnavailableAIProvider(): AIProvider {
  return {
    id: 'unavailable',
    getStatus: () => unavailable(AI_NOT_CONNECTED),
    async sendMessage() {
      throw new ProviderUnavailableError('conversation', AI_NOT_CONNECTED);
    },
    async planTask() {
      throw new ProviderUnavailableError('conversation', AI_NOT_CONNECTED);
    },
    async checkConnection() {
      return { configured: false, message: AI_NOT_CONNECTED };
    },
  };
}

export function createUnavailableVisionProvider(): VisionProvider {
  return {
    id: 'unavailable',
    getStatus: () => unavailable(VISION_NOT_CONNECTED),
    async describeScene() {
      throw new ProviderUnavailableError('scene-description', VISION_NOT_CONNECTED);
    },
    async readText() {
      throw new ProviderUnavailableError('text-reading', VISION_NOT_CONNECTED);
    },
    async quickRead() {
      throw new ProviderUnavailableError('text-reading', VISION_NOT_CONNECTED);
    },
    async askAboutText() {
      throw new ProviderUnavailableError('text-reading', VISION_NOT_CONNECTED);
    },
    async checkScene() {
      throw new ProviderUnavailableError('scene-description', VISION_NOT_CONNECTED);
    },
  };
}

export function createUnavailableObjectDetectionProvider(): ObjectDetectionProvider {
  return {
    id: 'unavailable',
    getStatus: () => unavailable(DETECTION_NOT_CONNECTED),
    async findObject() {
      throw new ProviderUnavailableError('object-finding', DETECTION_NOT_CONNECTED);
    },
  };
}
