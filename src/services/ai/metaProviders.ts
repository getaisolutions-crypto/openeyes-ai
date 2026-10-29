import {
  AIRequestError,
  type AIProvider,
  type AnswerBasis,
  type ConfidenceLevel,
  type ObjectDetectionProvider,
  type ObjectVisibility,
  type SceneChangeCategory,
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
const BASIS: Record<string, AnswerBasis> = {
  exact: 'exact',
  summary: 'summary',
  inference: 'inference',
  not_found: 'not-found',
};
const SCENE_CATEGORY: Record<string, SceneChangeCategory> = {
  person: 'person',
  door: 'door',
  stairs: 'stairs',
  new_area: 'new-area',
  object: 'object',
  other: 'other',
};

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

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
    async planTask(taskName, options) {
      const body = await backend.post({ task: 'task_plan', taskName }, options?.signal);
      const plan = body.plan as Record<string, unknown> | undefined;
      if (!plan || !Array.isArray(plan.steps)) badResponse();
      const steps = plan.steps.map(stringField).filter(Boolean);
      return { steps, modelId: 'muse-spark', modelVersion: modelVersion(body) };
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
    async quickRead(image, options) {
      const body = await backend.post({ task: 'quick_read', image: await imagePayload(image) }, options?.signal);
      const q = body.quickRead as Record<string, unknown> | undefined;
      if (!q || typeof q.readable !== 'boolean') badResponse();
      const keyText = stringField(q.keyText);
      const readable = q.readable && Boolean(keyText);
      return {
        readable,
        documentType: stringField(q.documentType) || 'unknown',
        keyText: readable ? keyText : '',
        summary: readable ? stringField(q.summary) : '',
        reason: readable ? '' : stringField(q.reason),
        modelId: 'muse-spark',
        modelVersion: modelVersion(body),
      };
    },
    async askAboutText(image, question, options) {
      const body = await backend.post(
        { task: 'ask_text', question, image: await imagePayload(image) },
        options?.signal,
      );
      const a = body.answer as Record<string, unknown> | undefined;
      const basis = typeof a?.basis === 'string' ? BASIS[a.basis] : undefined;
      const answer = stringField(a?.answer);
      if (!a || !basis || !answer) badResponse();
      return {
        answer,
        basis,
        quote: basis === 'not-found' ? '' : stringField(a.quote),
        modelId: 'muse-spark',
        modelVersion: modelVersion(body),
      };
    },
    async checkScene(image, { previousSummary, signal }) {
      const body = await backend.post(
        { task: 'scene_check', previousSummary, image: await imagePayload(image) },
        signal,
      );
      const s = body.scene as Record<string, unknown> | undefined;
      const summary = stringField(s?.summary);
      if (!s || !summary) badResponse();
      const objects = Array.isArray(s.objects) ? s.objects.map(stringField).filter(Boolean) : [];
      const changes = Array.isArray(s.changes)
        ? s.changes
            .map((c) => {
              const item = (c ?? {}) as Record<string, unknown>;
              const category = typeof item.category === 'string' ? SCENE_CATEGORY[item.category] : undefined;
              return { category: category ?? ('other' as const), text: stringField(item.text) };
            })
            .filter((c) => c.text)
        : [];
      return {
        summary,
        objects,
        changes,
        confidence: CONFIDENCE.find((c) => c === s.confidence) ?? 'low',
        modelId: 'muse-spark',
        modelVersion: modelVersion(body),
      };
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
