// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  LIMITS,
  META_API_BASE_URL,
  buildMetaRequest,
  handleRequest,
  parseAskTextResult,
  parseFindResult,
  parseQuickReadResult,
  parseReadResult,
  parseSceneCheck,
  parseTaskPlan,
  type HandlerDeps,
} from '../../supabase/functions/openeyes-ai/core.ts';

const IMAGE = { dataUrl: 'data:image/jpeg;base64,/9j/AAAA', capturedAt: '2026-01-01T10:00:00.000Z' };

function metaReply(content: string, model = 'muse-spark-1.3') {
  return new Response(JSON.stringify({ model, choices: [{ message: { role: 'assistant', content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    apiKey: 'test-key',
    model: 'muse-spark-1.3',
    fetchImpl: vi.fn(async () => metaReply('A desk with a laptop in the centre.')) as unknown as typeof fetch,
    consumeQuota: vi.fn(async () => true),
    now: () => new Date('2026-01-01T10:01:00.000Z'),
    ...overrides,
  };
}

function post(body: unknown) {
  return new Request('https://example.test/functions/v1/openeyes-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe('OpenEyes AI server function (mocked Meta API, no real network)', () => {
  it('sends an OpenAI-compatible chat completion with the image and bearer auth', async () => {
    const d = deps();
    const res = await handleRequest(post({ task: 'describe', responseLength: 'brief', image: IMAGE }), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ task: 'describe', model: 'muse-spark-1.3', text: 'A desk with a laptop in the centre.' });

    const [url, init] = (d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${META_API_BASE_URL}/chat/completions`);
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('muse-spark-1.3');
    const userParts = body.messages[body.messages.length - 1].content;
    expect(userParts).toContainEqual({ type: 'image_url', image_url: { url: IMAGE.dataUrl } });
    expect(d.consumeQuota).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('reports a health check without exposing the key', async () => {
    const res = await handleRequest(new Request('https://example.test', { method: 'GET' }), deps({ apiKey: undefined }));
    expect(await res.json()).toEqual({ configured: false, model: 'muse-spark-1.3' });
  });

  it('refuses requests when the Meta API key is not configured', async () => {
    const d = deps({ apiKey: undefined });
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), d);
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe('not_configured');
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('maps rejected credentials to meta_auth_failed', async () => {
    const d = deps({ fetchImpl: vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch });
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), d);
    expect(res.status).toBe(502);
    expect(await errorCode(res)).toBe('meta_auth_failed');
  });

  it('maps a network failure to meta_unreachable', async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), d);
    expect(await errorCode(res)).toBe('meta_unreachable');
  });

  it('passes on Meta rate limits with a retry time', async () => {
    const d = deps({
      fetchImpl: vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '12' } })) as unknown as typeof fetch,
    });
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('12');
    expect(await errorCode(res)).toBe('meta_rate_limited');
  });

  it('times out slow Meta responses', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), deps({ fetchImpl, timeoutMs: 20 }));
    expect(res.status).toBe(504);
    expect(await errorCode(res)).toBe('meta_timeout');
  });

  it('rejects unsupported image formats', async () => {
    const res = await handleRequest(
      post({ task: 'describe', image: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } }),
      deps(),
    );
    expect(res.status).toBe(415);
    expect(await errorCode(res)).toBe('unsupported_image');
  });

  it('rejects images over the size limit', async () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(LIMITS.imageDataUrlChars)}`;
    const res = await handleRequest(post({ task: 'describe', image: { dataUrl: big } }), deps());
    expect(res.status).toBe(413);
    expect(await errorCode(res)).toBe('image_too_large');
  });

  it('enforces the per-device usage limit', async () => {
    const d = deps({ consumeQuota: vi.fn(async () => false) });
    const res = await handleRequest(post({ task: 'describe', image: IMAGE }), d);
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe('quota_exceeded');
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('requires a photo for describe, find and read', async () => {
    const res = await handleRequest(post({ task: 'read' }), deps());
    expect(res.status).toBe(400);
  });

  it('returns a structured "not visible" result for find without a position', async () => {
    const d = deps({
      fetchImpl: vi.fn(async () =>
        metaReply('{"visibility":"not_visible","position":"left","confidence":"medium","suggestion":"Try the table."}'),
      ) as unknown as typeof fetch,
    });
    const res = await handleRequest(post({ task: 'find', objectName: 'keys', image: IMAGE }), d);
    const body = (await res.json()) as { find: Record<string, string> };
    expect(body.find).toEqual({ visibility: 'not_visible', position: '', confidence: 'medium', suggestion: 'Try the table.' });
  });

  it('treats NO_READABLE_TEXT as unreadable and keeps line breaks otherwise', () => {
    expect(parseReadResult('NO_READABLE_TEXT')).toEqual({ text: '', readable: false });
    expect(parseReadResult('Line one\nLine two')).toEqual({ text: 'Line one\nLine two', readable: true });
  });

  it('rejects a find answer that is not the expected JSON', () => {
    expect(() => parseFindResult('I think the keys are there')).toThrow();
  });

  it('tells the model how old the photo is and labels memories as saved notes', () => {
    const request = buildMetaRequest(
      {
        task: 'chat',
        responseLength: 'brief',
        image: IMAGE,
        messages: [{ role: 'user', content: 'Where are my keys?' }],
        memories: ['My keys are usually on the hook.'],
      },
      'muse-spark-1.3',
      new Date('2026-01-01T10:05:00.000Z'),
    );
    const text = JSON.stringify(request.messages);
    expect(text).toMatch(/5 minutes/);
    expect(text).toMatch(/NOT current observations/);
    expect(text).toContain('My keys are usually on the hook.');
  });
});

describe('openeyes-ai Phase 5-7 tasks', () => {
  it('keeps unreadable quick reads empty instead of guessing', () => {
    expect(parseQuickReadResult('{"readable":false,"keyText":"maybe Aspirin","reason":"Too blurry"}')).toMatchObject({
      readable: false,
      keyText: '',
      reason: 'Too blurry',
    });
    expect(parseQuickReadResult('```json\n{"readable":true,"documentType":"label","keyText":"Aspirin 300mg","summary":"A medicine label."}\n```')).toMatchObject({
      readable: true,
      keyText: 'Aspirin 300mg',
    });
  });

  it('requires a known answer basis for document questions', () => {
    expect(parseAskTextResult('{"answer":"November 15","basis":"exact","quote":"Reply by November 15"}').basis).toBe('exact');
    expect(parseAskTextResult('{"answer":"Not stated","basis":"not_found","quote":"ignored"}').quote).toBe('');
    expect(() => parseAskTextResult('{"answer":"Probably Tuesday","basis":"guess"}')).toThrow();
  });

  it('caps task plans and rejects malformed ones', () => {
    const many = JSON.stringify({ steps: Array.from({ length: 30 }, (_, i) => `Step ${i}`) });
    expect(parseTaskPlan(many).steps.length).toBe(LIMITS.planSteps);
    expect(() => parseTaskPlan('{"steps":"boil water"}')).toThrow();
  });

  it('defaults scene checks to low confidence and known categories', () => {
    const scene = parseSceneCheck('{"summary":"A doorway.","changes":[{"category":"teleport","text":"Something"}],"objects":["door"]}');
    expect(scene.confidence).toBe('low');
    expect(scene.changes[0].category).toBe('other');
    expect(() => parseSceneCheck('{"summary":""}')).toThrow();
  });

  it('validates the new request fields before calling Meta', async () => {
    const d = deps();
    expect((await handleRequest(post({ task: 'ask_text', image: IMAGE }), d)).status).toBe(400);
    expect((await handleRequest(post({ task: 'task_plan' }), d)).status).toBe(400);
    expect((await handleRequest(post({ task: 'scene_check' }), d)).status).toBe(400);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  it('tells Meta AI never to call a route safe in scene checks and returns a structured plan', async () => {
    const fetchImpl = vi.fn(async () => metaReply('{"steps":["Fill the kettle.","Boil the water."]}')) as unknown as typeof fetch;
    const res = await handleRequest(post({ task: 'task_plan', taskName: 'make coffee' }), deps({ fetchImpl }));
    expect(await res.json()).toMatchObject({ task: 'task_plan', plan: { steps: ['Fill the kettle.', 'Boil the water.'] } });
    const request = buildMetaRequest(
      { task: 'scene_check', responseLength: 'brief', image: IMAGE, previousSummary: 'A hallway.', messages: [], memories: [] },
      'muse-spark-1.3',
      new Date(),
    );
    const text = JSON.stringify(request);
    expect(text).toMatch(/Never say a path/);
    expect(text).toContain('A hallway.');
  });
});
