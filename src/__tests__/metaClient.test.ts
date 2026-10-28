import { describe, expect, it, vi } from 'vitest';
import { createOpenEyesBackend, type OpenEyesBackend } from '../services/ai/openEyesBackend';
import { createMetaProviders } from '../services/ai/metaProviders';
import { AI_IMAGE_LIMITS, scaleToFit, validateImageForAI } from '../services/ai/imagePreparation';
import {
  CONTEXT_MESSAGE_LIMIT,
  boundConversation,
  parseRememberRequest,
  selectRelevantMemories,
} from '../services/ai/conversationContext';
import { AIRequestError, type ChatMessage } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import type { Memory } from '../types/memory';

const URL_ = 'https://example.test/functions/v1/openeyes-ai';

function image(overrides: Partial<CapturedImage> = {}): CapturedImage {
  return {
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    previewUrl: 'blob:test',
    width: 640,
    height: 480,
    capturedAt: '2026-01-01T10:00:00.000Z',
    source: 'phone',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function hangingFetch() {
  return vi.fn(
    (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  ) as unknown as typeof fetch;
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    return err instanceof AIRequestError ? err.kind : 'other';
  }
  return 'resolved';
}

function fakeBackend(reply: Record<string, unknown>): OpenEyesBackend & { post: ReturnType<typeof vi.fn> } {
  return {
    post: vi.fn(async () => reply),
    health: vi.fn(async () => ({ configured: false, model: 'muse-spark-1.3' })),
  };
}

const encode = vi.fn(async () => 'data:image/jpeg;base64,/9j/AAAA');

describe('OpenEyes backend client (mocked fetch)', () => {
  it('posts JSON with the public app key and returns the body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { task: 'describe', text: 'A chair.' })) as unknown as typeof fetch;
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'public-anon', fetchImpl });
    expect(await backend.post({ task: 'describe' })).toEqual({ task: 'describe', text: 'A chair.' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer public-anon');
    expect(JSON.parse(init.body)).toEqual({ task: 'describe' });
  });

  it.each([
    [{ code: 'meta_auth_failed' }, 502, 'auth'],
    [{ code: 'not_configured' }, 503, 'not-configured'],
    [{ code: 'unsupported_image' }, 415, 'unsupported-image'],
    [{ code: 'image_too_large' }, 413, 'image-too-large'],
    [{ code: 'quota_exceeded', retryAfterSeconds: 60 }, 429, 'rate-limited'],
    [{ code: 'meta_timeout' }, 504, 'timeout'],
  ])('maps server error %o to %s', async (error, status, kind) => {
    const fetchImpl = vi.fn(async () => jsonResponse(status, { error })) as unknown as typeof fetch;
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'k', fetchImpl });
    expect(await kindOf(backend.post({}))).toBe(kind);
  });

  it('reports network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'k', fetchImpl });
    expect(await kindOf(backend.post({}))).toBe('network');
  });

  it('times out', async () => {
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'k', fetchImpl: hangingFetch(), timeoutMs: 20 });
    expect(await kindOf(backend.post({}))).toBe('timeout');
  });

  it('can be cancelled by the user', async () => {
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'k', fetchImpl: hangingFetch() });
    const controller = new AbortController();
    const pending = kindOf(backend.post({}, controller.signal));
    controller.abort();
    expect(await pending).toBe('cancelled');
  });

  it('flags a non-JSON success body as a bad response', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    const backend = createOpenEyesBackend({ url: URL_, publicKey: 'k', fetchImpl });
    expect(await kindOf(backend.post({}))).toBe('bad-response');
  });
});

describe('Meta providers (mocked backend)', () => {
  it('describes a scene and reuses the encoded photo for repeat requests', async () => {
    const backend = fakeBackend({ task: 'describe', model: 'muse-spark-1.3', text: 'A kitchen counter with a kettle on the left.' });
    const localEncode = vi.fn(encode);
    const { vision } = createMetaProviders(backend, localEncode);
    const photo = image();
    const first = await vision.describeScene(photo, { responseLength: 'brief' });
    await vision.describeScene(photo, { responseLength: 'brief' });
    expect(first.summary).toBe('A kitchen counter with a kettle on the left.');
    expect(first.modelVersion).toBe('muse-spark-1.3');
    expect(localEncode).toHaveBeenCalledTimes(1);
    expect(backend.post.mock.calls[0][0]).toMatchObject({
      task: 'describe',
      image: { dataUrl: 'data:image/jpeg;base64,/9j/AAAA', capturedAt: photo.capturedAt },
    });
  });

  it('reports an object that was not found without a position', async () => {
    const backend = fakeBackend({
      task: 'find',
      find: { visibility: 'not_visible', position: 'ignored', confidence: 'medium', suggestion: 'Try the shelf.' },
    });
    const { objectDetection } = createMetaProviders(backend, encode);
    const result = await objectDetection.findObject('keys', image());
    expect(result).toMatchObject({ visibility: 'not-visible', positionDescription: '', confidence: 'medium', matches: [] });
  });

  it('rejects a malformed find answer instead of guessing', async () => {
    const { objectDetection } = createMetaProviders(fakeBackend({ find: { visibility: 'maybe' } }), encode);
    expect(await kindOf(objectDetection.findObject('keys', image()))).toBe('bad-response');
  });

  it('returns unreadable text honestly', async () => {
    const { vision } = createMetaProviders(fakeBackend({ task: 'read', text: '', readable: false }), encode);
    expect(await vision.readText(image())).toMatchObject({ text: '', readable: false });
  });

  it('keeps line breaks in readable text', async () => {
    const { vision } = createMetaProviders(fakeBackend({ task: 'read', text: 'Aspirin\n2 tablets', readable: true }), encode);
    expect((await vision.readText(image())).text).toBe('Aspirin\n2 tablets');
  });

  it('rejects unsupported photo types before anything is sent', async () => {
    const backend = fakeBackend({});
    const { vision } = createMetaProviders(backend, encode);
    const svg = image({ blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) });
    expect(await kindOf(vision.describeScene(svg, { responseLength: 'brief' }))).toBe('unsupported-image');
    expect(backend.post).not.toHaveBeenCalled();
  });

  it('sends only the most recent messages plus relevant memories and the photo', async () => {
    const backend = fakeBackend({ task: 'chat', text: 'You saved a note that your keys are on the hook.' });
    const { ai } = createMetaProviders(backend, encode);
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
      createdAt: '2026-01-01T10:00:00.000Z',
    }));
    const response = await ai.sendMessage({
      messages,
      responseLength: 'brief',
      memories: ['Keys are on the hook.'],
      image: image(),
    });
    const payload = backend.post.mock.calls[0][0];
    expect(payload.messages.length).toBeLessThanOrEqual(CONTEXT_MESSAGE_LIMIT);
    expect(payload.messages[0].role).toBe('user');
    expect(payload.messages.at(-1).content).toBe('message 14');
    expect(payload.memories).toEqual(['Keys are on the hook.']);
    expect(payload.image.dataUrl).toMatch(/^data:image\/jpeg/);
    expect(response.message.role).toBe('assistant');
  });

  it('reports a server without a Meta key as not configured', async () => {
    const { ai } = createMetaProviders(fakeBackend({}), encode);
    expect(await ai.checkConnection()).toMatchObject({ configured: false });
  });
});

describe('image preparation and conversation helpers', () => {
  it('enforces type and size limits', () => {
    expect(() => validateImageForAI(image({ blob: new Blob(['x'], { type: 'image/bmp' }) }))).toThrow(AIRequestError);
    const huge = { size: AI_IMAGE_LIMITS.maxSourceBytes + 1, type: 'image/jpeg' } as Blob;
    expect(() => validateImageForAI(image({ blob: huge }))).toThrow(/large/i);
  });

  it('scales large photos down while keeping the aspect ratio', () => {
    expect(scaleToFit(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(scaleToFit(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('starts the bounded context on a user message', () => {
    const msgs = ['assistant', 'user', 'assistant', 'user'].map(
      (role, i) => ({ id: String(i), role, content: String(i), createdAt: '' }) as ChatMessage,
    );
    expect(boundConversation(msgs, 2).map((m) => m.id)).toEqual(['3']);
    expect(boundConversation(msgs, 3).map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('recognises "remember that" requests but not questions', () => {
    expect(parseRememberRequest('Remember that my keys are on the hook')).toBe('My keys are on the hook.');
    expect(parseRememberRequest('Please remember the blue door is my building')).toBe('The blue door is my building.');
    expect(parseRememberRequest('Do you remember where my keys are?')).toBeNull();
    expect(parseRememberRequest('What is in front of me')).toBeNull();
  });

  it('picks memories that share words with the question', () => {
    const memories = [
      { id: '1', text: 'My keys are on the hook by the door.', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', text: 'The bus stop is past the bakery.', updatedAt: '2026-01-01T00:00:00.000Z' },
    ] as Memory[];
    expect(selectRelevantMemories(memories, 'Where are my keys?').map((m) => m.id)).toEqual(['1']);
  });
});
