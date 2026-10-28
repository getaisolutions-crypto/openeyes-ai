import { describe, expect, it, vi } from 'vitest';
import { META_VOICE_LIMITS, createMetaVoiceRecognizer, type WebSocketLike } from '../services/voice/metaVoiceRecognizer';
import { MAX_PRIMARY_FAILURES, createRecognizerWithFallback } from '../services/voice/recognizerFallback';
import { createPcm16Framer } from '../services/voice/pcmCapture';
import type { ListeningHandlers, SpeechRecognizer } from '../types/voice';

class MockSocket implements WebSocketLike {
  binaryType = 'blob';
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  closed = false;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public url: string) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  ends() {
    return this.sent.filter((d) => d === JSON.stringify({ type: 'end' })).length;
  }
}

function setup(opts: { ticketStatus?: number; captureError?: string } = {}) {
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const sockets: MockSocket[] = [];
  const captureStop = vi.fn();
  let pushFrame: ((f: ArrayBuffer) => void) | null = null;
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify(opts.ticketStatus ? { error: { code: 'x' } } : { ticket: 'a'.repeat(43) }), {
      status: opts.ticketStatus ?? 200,
    }),
  );
  const recognizer = createMetaVoiceRecognizer({
    functionUrl: 'https://proj.supabase.co/functions/v1/openeyes-voice',
    publicKey: 'public-anon',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    createSocket: (url) => {
      const s = new MockSocket(url);
      sockets.push(s);
      return s;
    },
    startCapture: async (onFrame) => {
      if (opts.captureError) throw opts.captureError;
      pushFrame = onFrame;
      return { stop: captureStop };
    },
    isCaptureSupported: () => true,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const handlers = {
    onInterim: vi.fn(),
    onFinal: vi.fn(),
    onError: vi.fn(),
    onEnd: vi.fn(),
  } satisfies ListeningHandlers;
  const advance = (ms: number) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > target) break;
      timers.shift();
      clock = t.at;
      t.fn();
    }
    clock = target;
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { recognizer, handlers, sockets, fetchImpl, captureStop, frame: (f: ArrayBuffer) => pushFrame?.(f), advance, flush, timers };
}

async function connected(opts?: Parameters<typeof setup>[0]) {
  const t = setup(opts);
  const session = t.recognizer.startListening(t.handlers);
  await t.flush();
  const socket = t.sockets[0];
  socket.open();
  return { ...t, session, socket };
}

describe('Meta Voice recognizer', () => {
  it('gets a ticket with the public key and opens the relay with only the ticket in the URL', async () => {
    const t = await connected();
    const [url, init] = t.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/functions/v1/openeyes-voice');
    expect(init.method).toBe('POST');
    expect(t.socket.url).toBe(`wss://proj.supabase.co/functions/v1/openeyes-voice?ticket=${'a'.repeat(43)}`);
    expect(t.socket.url).not.toContain('public-anon');
    expect(t.socket.binaryType).toBe('arraybuffer');
  });

  it('holds audio until the relay is ready, then sends it in order', async () => {
    const t = await connected();
    const a = new ArrayBuffer(2560);
    const b = new ArrayBuffer(2560);
    t.frame(a);
    expect(t.socket.sent).toHaveLength(0);
    t.socket.emit({ type: 'ready' });
    t.frame(b);
    expect(t.socket.sent).toEqual([a, b]);
  });

  it('shows partial transcripts and submits only Meta\'s completed turn', async () => {
    const t = await connected();
    t.socket.emit({ type: 'ready' });
    t.socket.emit({ type: 'speechStart', turnId: '1' });
    t.socket.emit({ type: 'transcript', text: "What's", final: false });
    t.socket.emit({ type: 'transcript', text: "What's around", final: false });
    expect(t.handlers.onFinal).not.toHaveBeenCalled();
    expect(t.handlers.onInterim).toHaveBeenLastCalledWith("What's around");
    t.socket.emit({ type: 'speechEnd', turnId: '1' });
    t.socket.emit({ type: 'speechComplete', turnId: '1', text: "What's around me?" });
    expect(t.handlers.onFinal).toHaveBeenCalledWith("What's around me?");
    expect(t.handlers.onFinal).toHaveBeenCalledTimes(1);
    expect(t.handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(t.handlers.onError).not.toHaveBeenCalled();
    expect(t.captureStop).toHaveBeenCalled();
    expect(t.socket.closed).toBe(true);
    expect(t.timers).toHaveLength(0);
  });

  it('keeps listening after an empty completed turn', async () => {
    const t = await connected();
    t.socket.emit({ type: 'ready' });
    t.socket.emit({ type: 'speechComplete', turnId: '1', text: '  ' });
    expect(t.handlers.onEnd).not.toHaveBeenCalled();
    expect(t.handlers.onFinal).not.toHaveBeenCalled();
  });

  it('ends with no-speech when nothing is said', async () => {
    const t = await connected();
    t.socket.emit({ type: 'ready' });
    t.advance(META_VOICE_LIMITS.noSpeechMs);
    expect(t.handlers.onError).toHaveBeenCalledWith('no-speech');
    expect(t.handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(t.captureStop).toHaveBeenCalled();
  });

  it('stop asks Meta to finish and still delivers the final words', async () => {
    const t = await connected();
    t.socket.emit({ type: 'ready' });
    t.socket.emit({ type: 'speechStart', turnId: '1' });
    t.session.stop();
    expect(t.captureStop).toHaveBeenCalled();
    expect(t.socket.ends()).toBe(1);
    t.socket.emit({ type: 'speechComplete', turnId: '1', text: 'Read the sign' });
    expect(t.handlers.onFinal).toHaveBeenCalledWith('Read the sign');
  });

  it('abort closes the microphone and the connection with no later callbacks', async () => {
    const t = await connected();
    t.socket.emit({ type: 'ready' });
    t.session.abort();
    expect(t.captureStop).toHaveBeenCalled();
    expect(t.socket.closed).toBe(true);
    expect(t.handlers.onError).toHaveBeenCalledWith('aborted');
    t.socket.emit({ type: 'speechComplete', text: 'late' });
    t.advance(60_000);
    expect(t.handlers.onFinal).not.toHaveBeenCalled();
    expect(t.handlers.onEnd).toHaveBeenCalledTimes(1);
  });

  it('abort before the ticket arrives never opens a connection', async () => {
    const t = setup();
    const session = t.recognizer.startListening(t.handlers);
    session.abort();
    await t.flush();
    expect(t.sockets).toHaveLength(0);
    expect(t.captureStop).toHaveBeenCalled();
  });

  it.each([401, 429, 503])('reports the service as unavailable when the ticket request returns %i', async (status) => {
    const t = setup({ ticketStatus: status });
    t.recognizer.startListening(t.handlers);
    await t.flush();
    expect(t.handlers.onError).toHaveBeenCalledWith('service-unavailable');
    expect(t.captureStop).toHaveBeenCalled();
  });

  it('reports a dropped connection and a relay error as unavailable', async () => {
    const a = await connected();
    a.socket.emit({ type: 'ready' });
    a.socket.onclose?.({});
    expect(a.handlers.onError).toHaveBeenCalledWith('service-unavailable');

    const b = await connected();
    b.socket.emit({ type: 'ready' });
    b.socket.emit({ type: 'error', code: 'upstream_error' });
    expect(b.handlers.onError).toHaveBeenCalledWith('service-unavailable');
  });

  it('times out when the relay never becomes ready', async () => {
    const t = await connected();
    t.advance(META_VOICE_LIMITS.connectTimeoutMs);
    expect(t.handlers.onError).toHaveBeenCalledWith('service-unavailable');
    expect(t.socket.closed).toBe(true);
  });

  it('passes microphone permission errors through', async () => {
    const t = setup({ captureError: 'permission-denied' });
    t.recognizer.startListening(t.handlers);
    await t.flush();
    expect(t.handlers.onError).toHaveBeenCalledWith('permission-denied');
  });
});

function fakeRecognizer(id: SpeechRecognizer['id'], behaviour: (h: ListeningHandlers) => void) {
  const abort = vi.fn();
  return {
    id,
    isSupported: () => true,
    startListening: vi.fn((h: ListeningHandlers) => {
      behaviour(h);
      return { stop: vi.fn(), abort };
    }),
    abort,
  };
}

const unavailable = (h: ListeningHandlers) => {
  h.onError('service-unavailable');
  h.onEnd();
};

describe('browser fallback', () => {
  it('finishes the same turn with the browser when Meta is unavailable', () => {
    const meta = fakeRecognizer('meta-voice', unavailable);
    const browser = fakeRecognizer('browser', (h) => {
      h.onFinal('hello');
      h.onEnd();
    });
    const onFallback = vi.fn();
    const r = createRecognizerWithFallback(meta, browser, onFallback);
    const h = { onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    r.startListening(h);
    expect(h.onFinal).toHaveBeenCalledWith('hello');
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('turn', 'browser');
    expect(r.activeId).toBe('meta-voice');
  });

  it(`uses the browser for the rest of the conversation after ${MAX_PRIMARY_FAILURES} failures`, () => {
    const meta = fakeRecognizer('meta-voice', unavailable);
    const browser = fakeRecognizer('browser', (h) => h.onEnd());
    const onFallback = vi.fn();
    const r = createRecognizerWithFallback(meta, browser, onFallback);
    for (let i = 0; i < MAX_PRIMARY_FAILURES + 2; i++) r.startListening({ onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    expect(meta.startListening).toHaveBeenCalledTimes(MAX_PRIMARY_FAILURES);
    expect(onFallback).toHaveBeenLastCalledWith('session', 'browser');
    expect(r.activeId).toBe('browser');
  });

  it('does not fall back for silence or permission problems', () => {
    const meta = fakeRecognizer('meta-voice', (h) => {
      h.onError('no-speech');
      h.onEnd();
    });
    const browser = fakeRecognizer('browser', () => undefined);
    const r = createRecognizerWithFallback(meta, browser, vi.fn());
    const h = { onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    r.startListening(h);
    expect(h.onError).toHaveBeenCalledWith('no-speech');
    expect(browser.startListening).not.toHaveBeenCalled();
  });

  it('does not start the browser after the turn was cancelled', () => {
    let handlers: ListeningHandlers | null = null;
    const meta = fakeRecognizer('meta-voice', (h) => {
      handlers = h;
    });
    const browser = fakeRecognizer('browser', () => undefined);
    const r = createRecognizerWithFallback(meta, browser, vi.fn());
    const session = r.startListening({ onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    session.abort();
    handlers!.onError('service-unavailable');
    handlers!.onEnd();
    expect(browser.startListening).not.toHaveBeenCalled();
    expect(meta.abort).toHaveBeenCalled();
  });

  it('starts with the browser when Meta cannot run here', () => {
    const meta = { ...fakeRecognizer('meta-voice', () => undefined), isSupported: () => false };
    const browser = fakeRecognizer('browser', () => undefined);
    const r = createRecognizerWithFallback(meta, browser, vi.fn());
    expect(r.activeId).toBe('browser');
    r.startListening({ onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    expect(browser.startListening).toHaveBeenCalled();
  });
});

describe('PCM framing', () => {
  it('resamples 48 kHz audio into 80 ms frames of 16-bit samples at 16 kHz', () => {
    const frames: Int16Array[] = [];
    const framer = createPcm16Framer(48_000, (f) => frames.push(new Int16Array(f)));
    const second = new Float32Array(48_000).fill(0.5);
    framer(second.subarray(0, 20_000));
    framer(second.subarray(20_000));
    expect(frames).toHaveLength(12);
    expect(frames.every((f) => f.length === 1280)).toBe(true);
    expect(frames[3][100]).toBeCloseTo(0.5 * 32767, -1);
  });

  it('clips out-of-range samples', () => {
    const frames: Int16Array[] = [];
    const framer = createPcm16Framer(16_000, (f) => frames.push(new Int16Array(f)));
    framer(new Float32Array(1281).fill(2));
    expect(frames[0][0]).toBe(32767);
  });
});
