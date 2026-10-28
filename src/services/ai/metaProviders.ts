import {
  AIRequestError,
  type AIProvider,
  type ConfidenceLevel,
  type ObjectDetectionProvider,
  type ObjectVisibility,
  type VisionProvider,
} from '../../types/ai';
import type { CapturedImage } from '../../types/camera';
import { createId } from '../../utils/id';
import { boundConversation } from './conversationContext';
import { encodeImageForAI, validateImageForAI, type ImageEncoder } from './imagePreparation';
import { AI_ERROR_MESSAGES, type OpenEyesBackend } from './openEyesBackend';

const VISIBILITY: Record<string, ObjectVisibility> = {
  visible: 'visible',
  not_visible: 'not-visible',
  uncertain: 'uncertain',
};
const CONFIDENCE: ConfidenceLevel[] = ['high', 'medium', 'low'];

function badResponse(): never {
  throw new AIRequestError('bad-response', AI_ERROR_MESSAGES['bad-response']);
}

function requireText(body: Record<string, unknown>): string {
  if (typeof body.text !== 'string' || !body.text.trim()) badResponse();
  return body.text.trim();
}

function modelVersion(body: Record<string, unknown>): string | undefined {
  return typeof body.model === 'string' && body.model ? body.model : undefined;
}

export interface MetaProviders {
  ai: AIProvider;
  vision: VisionProvider;
  objectDetection: ObjectDetectionProvider;
}

/**
 * Muse Spark providers. Every call goes to the OpenEyes server, which holds the Meta API key.
 * Photos are only sent when the user explicitly asks, and each photo is compressed once and reused.
 */
export function createMetaProviders(backend: OpenEyesBackend, encode: ImageEncoder = encodeImageForAI): MetaProviders {
  const encoded = new WeakMap<Blob, Promise<string>>();

  async function imagePayload(image: CapturedImage) {
    validateImageForAI(image);
    let pending = encoded.get(image.blob);
    if (!pending) {
      pending = encode(image);
      encoded.set(image.blob, pending);
      pending.catch(() => encoded.delete(image.blob));
    }
    return { dataUrl: await pending, capturedAt: image.capturedAt };
  }

  const available = () => ({ available: true });

  const ai: AIProvider = {
    id: 'meta-muse-spark',
    getStatus: available,
    async sendMessage({ messages, responseLength, image, memories, signal }) {
      const context = boundConversation(messages);
      if (context.length === 0 || context[context.length - 1].role !== 'user') {
        throw new AIRequestError('rejected', AI_ERROR_MESSAGES.rejected);
      }
      const body = await backend.post(
        {
          task: 'chat',
          responseLength,
          messages: context.map((m) => ({ role: m.role, content: m.content })),
          memories: memories ?? [],
          image: image ? await imagePayload(image) : undefined,
        },
        signal,
      );
      return {
        message: { id: createId(), role: 'assistant', content: requireText(body), createdAt: new Date().toISOString() },
        modelId: 'muse-spark',
        modelVersion: modelVersion(body),
      };
    },
    async checkConnection(signal) {
      const health = await backend.health(signal);
      return health.configured
        ? {
            configured: true,
            modelVersion: health.model,
            message: `The OpenEyes server is reachable and has a Meta API key. Model: ${health.model ?? 'unknown'}.`,
          }
        : {
            configured: false,
            modelVersion: health.model,
            message: 'The OpenEyes server is reachable, but the Meta API key has not been added yet. AI features will not work until it is.',
          };
    },
  };

  const vision: VisionProvider = {
    id: 'meta-muse-spark',
    getStatus: available,
    async describeScene(image, { responseLength, signal }) {
      const body = await backend.post({ task: 'describe', responseLength, image: await imagePayload(image) }, signal);
      return { summary: requireText(body), modelId: 'muse-spark', modelVersion: modelVersion(body) };
    },
    async readText(image, options) {
      const body = await backend.post({ task: 'read', image: await imagePayload(image) }, options?.signal);
      if (typeof body.readable !== 'boolean' || typeof body.text !== 'string') badResponse();
      const text = body.readable ? body.text.trim() : '';
      return { text, readable: body.readable && Boolean(text), modelId: 'muse-spark', modelVersion: modelVersion(body) };
    },
  };

  const objectDetection: ObjectDetectionProvider = {
    id: 'meta-muse-spark',
    getStatus: available,
    async findObject(query, image, options) {
      const body = await backend.post(
        { task: 'find', objectName: query, image: await imagePayload(image) },
        options?.signal,
      );
      const find = body.find as Record<string, unknown> | undefined;
      const visibility = typeof find?.visibility === 'string' ? VISIBILITY[find.visibility] : undefined;
      if (!find || !visibility) badResponse();
      const confidence = CONFIDENCE.find((c) => c === find.confidence) ?? 'low';
      return {
        query,
        visibility,
        positionDescription:
          visibility !== 'not-visible' && typeof find.position === 'string' ? find.position.trim() : '',
        confidence,
        suggestion: typeof find.suggestion === 'string' ? find.suggestion.trim() : '',
        matches: [],
        modelId: 'muse-spark',
        modelVersion: modelVersion(body),
      };
    },
  };

  return { ai, vision, objectDetection };
}
