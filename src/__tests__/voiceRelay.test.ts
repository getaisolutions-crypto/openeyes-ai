// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  BYTES_PER_SECOND,
  RELAY_LIMITS,
  VOICE_MODEL,
  buildHandshake,
  closeReason,
  createAudioBudget,
  createRelaySession,
  handleTicketRequest,
  hasAppKey,
  toClientEvent,
  type SocketLike,
  type TicketResult,
} from '../../supabase/functions/openeyes-voice/core.ts';

class FakeSocket implements SocketLike {
  readyState = 1;
  sent: (string | ArrayBuffer | Uint8Array)[] = [];
  closed: number | null = null;
  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closed = code ?? 1000;
    this.readyState = 3;
  }
  json() {
    return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
  }
  binary() {
    return this.sent.filter((d) => typeof d !== 'string');
  }
}

function relay() {
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const client = new FakeSocket();
  const upstream = new FakeSocket();
  const onFinished = vi.fn();
  const session = createRelaySession({
    client,
    connectUpstream: () => upstream,
    apiKey: 'SECRET-KEY',
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    onFinished,
  });
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
  const frame = () => new Uint8Array(2560).buffer;
  const ack = () => session.onUpstreamMessage(JSON.stringify({ sessionId: 'abc' }));
  return { session, client, upstream, onFinished, advance, frame, ack, timers };
}

describe('Meta Voice relay: protocol', () => {
  it('builds the documented handshake with the key only inside the first frame', () => {
    expect(buildHandshake('K')).toEqual({
      authorization: { accessToken: 'Bearer K' },
      audioEncoding: 'PCM_16KHZ',
      model: VOICE_MODEL,
      mode: 'ENDPOINTING',
      partialMode: 'CUMULATIVE',
      emitAudioProgress: false,
    });
  });

  it('forwards only documented events and strips extra fields', () => {
    expect(toClientEvent(JSON.stringify({ type: 'transcript', transcript: 'hi', final: false, extra: 'x' }))).toEqual({
      type: 'transcript',
      text: 'hi',
      final: false,
    });
    expect(toClientEvent(JSON.stringify({ type: 'speechComplete', turnId: 3, transcript: 'done' }))).toEqual({
      type: 'speechComplete',
      turnId: '3',
      text: 'done',
    });
    expect(toClientEvent(JSON.stringify({ type: 'error', message: 'details with internals' }))).toEqual({ type: 'error', code: 'upstream_error' });
    expect(toClientEvent(JSON.stringify({ type: 'audioProgress' }))).toBeNull();
    expect(toClientEvent('not json')).toBeNull();
  });

  it('maps documented close codes', () => {
    expect(closeReason(1000)).toBe('normal');
    expect(closeReason(1008)).toBe('rejected');
    expect(closeReason(1011)).toBe('server');
    expect(closeReason(1013)).toBe('rate-limited');
    expect(closeReason(4000)).toBe('closed');
  });
});

describe('Meta Voice relay: audio transmission', () => {
  it('sends the handshake on open, buffers audio until Meta acknowledges, then forwards it', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    expect(t.upstream.json()[0].authorization.accessToken).toBe('Bearer SECRET-KEY');
    t.session.onClientMessage(t.frame());
    expect(t.upstream.binary()).toHaveLength(0);
    t.ack();
    expect(t.client.json()).toContainEqual({ type: 'ready' });
    expect(t.upstream.binary()).toHaveLength(1);
    t.advance(80);
    t.session.onClientMessage(t.frame());
    expect(t.upstream.binary()).toHaveLength(2);
  });

  it('never sends the key or raw Meta messages to the browser', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.ack();
    t.session.onUpstreamMessage(JSON.stringify({ type: 'transcript', transcript: 'what', final: false, debug: 'internal' }));
    const all = t.client.sent.join('');
    expect(all).not.toContain('SECRET-KEY');
    expect(all).not.toContain('internal');
    expect(t.client.json()).toContainEqual({ type: 'transcript', text: 'what', final: false });
  });

  it('rejects oversized and odd-length frames', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.ack();
    t.session.onClientMessage(new Uint8Array(RELAY_LIMITS.maxFrameBytes + 2).buffer);
    expect(t.client.json()).toContainEqual({ type: 'error', code: 'audio_policy' });
    expect(t.onFinished).toHaveBeenCalledWith(0, 'audio_policy');
  });

  it('rejects audio sent faster than real time', () => {
    const budget = createAudioBudget(() => 0);
    const frameBytes = 2560;
    const allowedFrames = Math.floor(((RELAY_LIMITS.maxAheadMs / 1000) * BYTES_PER_SECOND) / frameBytes);
    for (let i = 0; i < allowedFrames; i++) expect(budget.accept(frameBytes)).toBe('ok');
    expect(budget.accept(frameBytes)).toBe('too-fast');
  });

  it('stops accepting audio past the maximum duration', () => {
    let clock = 0;
    const budget = createAudioBudget(() => clock);
    let verdict = 'ok';
    while (verdict === 'ok') {
      clock += 80;
      verdict = budget.accept(2560);
    }
    expect(verdict).toBe('too-long');
    expect(budget.audioMs).toBeLessThanOrEqual(RELAY_LIMITS.connectionMaxMs);
  });
});

describe('Meta Voice relay: session lifecycle', () => {
  it('end from the browser sends endStream and finishes when Meta closes normally', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.ack();
    t.session.onClientMessage(t.frame());
    t.session.onClientMessage(JSON.stringify({ type: 'end' }));
    expect(t.upstream.json()).toContainEqual({ type: 'endStream' });
    t.session.onUpstreamMessage(JSON.stringify({ type: 'speechComplete', turnId: 1, transcript: 'hello' }));
    t.session.onUpstreamClose(1000);
    expect(t.client.json()).toContainEqual({ type: 'closed', reason: 'normal' });
    expect(t.onFinished).toHaveBeenCalledTimes(1);
    expect(t.onFinished).toHaveBeenCalledWith(80, 'upstream-1000');
    expect(JSON.stringify(t.onFinished.mock.calls)).not.toContain('hello');
  });

  it('times out when Meta never acknowledges the handshake', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.advance(RELAY_LIMITS.handshakeTimeoutMs);
    expect(t.client.json()).toContainEqual({ type: 'error', code: 'upstream_timeout' });
    expect(t.client.closed).toBe(1000);
  });

  it('reports a rejected handshake without details', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.session.onUpstreamMessage(JSON.stringify({ type: 'error', message: 'invalid key abc' }));
    expect(t.client.json()).toContainEqual({ type: 'error', code: 'upstream_error' });
    expect(t.client.sent.join('')).not.toContain('invalid key');
  });

  it('reports an unreachable Meta service', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamError();
    expect(t.client.json()).toContainEqual({ type: 'error', code: 'upstream_unreachable' });
  });

  it('ends the stream at the connection limit and then closes everything', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.ack();
    t.advance(RELAY_LIMITS.connectionMaxMs);
    expect(t.client.json()).toContainEqual({ type: 'error', code: 'session_limit' });
    expect(t.upstream.json()).toContainEqual({ type: 'endStream' });
    t.advance(RELAY_LIMITS.drainMs);
    expect(t.upstream.closed).toBe(1000);
    expect(t.timers).toHaveLength(0);
  });

  it('closing the browser closes the Meta connection and clears timers', () => {
    const t = relay();
    t.session.start();
    t.session.onUpstreamOpen();
    t.ack();
    t.session.onClientClose();
    expect(t.upstream.json()).toContainEqual({ type: 'endStream' });
    expect(t.upstream.closed).toBe(1000);
    expect(t.timers).toHaveLength(0);
    expect(t.onFinished).toHaveBeenCalledTimes(1);
  });
});

function jwt(claims: Record<string, unknown>) {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256' })}.${enc(claims)}.sig`;
}

describe('Meta Voice relay: tickets and authentication', () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const anonJwt = jwt({ role: 'anon', ref: 'proj', exp: future });
  const post = (key?: string) =>
    new Request('https://x/functions/v1/openeyes-voice', {
      method: 'POST',
      headers: key ? { Authorization: `Bearer ${key}`, apikey: key } : {},
    });
  const deps = (over: Partial<Parameters<typeof handleTicketRequest>[1]> = {}) => ({
    apiKey: 'SECRET-KEY',
    projectRef: 'proj',
    issueTicket: vi.fn(async (_client: string, _ticket: string) => 'ok' as TicketResult),
    randomToken: () => 'T'.repeat(43),
    ...over,
  });

  it('accepts only this project\'s public app key', () => {
    expect(hasAppKey(post(anonJwt), undefined, 'proj')).toBe(true);
    expect(hasAppKey(post(jwt({ role: 'anon', ref: 'other', exp: future })), undefined, 'proj')).toBe(false);
    expect(hasAppKey(post(jwt({ role: 'service_role', ref: 'proj', exp: future })), undefined, 'proj')).toBe(false);
    expect(hasAppKey(post(jwt({ role: 'anon', ref: 'proj', exp: 1 })), undefined, 'proj')).toBe(false);
    expect(hasAppKey(post(), undefined, 'proj')).toBe(false);
    expect(hasAppKey(post('exact'), 'exact', 'proj')).toBe(true);
  });

  it('issues a single ticket without exposing the Meta key', async () => {
    const issueTicket = vi.fn(async (_client: string, _ticket: string) => 'ok' as TicketResult);
    const res = await handleTicketRequest(post(anonJwt), deps({ issueTicket }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ticket: 'T'.repeat(43), sampleRate: 16000, frameMs: 80, maxSessionMs: RELAY_LIMITS.connectionMaxMs });
    expect(JSON.stringify(body)).not.toContain('SECRET-KEY');
    const [clientHash, ticketHash] = issueTicket.mock.calls[0];
    expect(ticketHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ticketHash).not.toContain('T'.repeat(43));
    expect(clientHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('refuses callers without the app key', async () => {
    const issueTicket = vi.fn(async (_client: string, _ticket: string) => 'ok' as TicketResult);
    const res = await handleTicketRequest(post(), deps({ issueTicket }));
    expect(res.status).toBe(401);
    expect(issueTicket).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After when limits are reached', async () => {
    const res = await handleTicketRequest(post(anonJwt), deps({ issueTicket: vi.fn(async () => 'audio-limit' as const) }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('reports a missing server key and a failed quota check safely', async () => {
    expect((await handleTicketRequest(post(anonJwt), deps({ apiKey: undefined }))).status).toBe(503);
    const res = await handleTicketRequest(post(anonJwt), deps({ issueTicket: vi.fn(async () => Promise.reject(new Error('db down'))) }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('db down');
  });

  it('GET reports whether voice is configured', async () => {
    const res = await handleTicketRequest(new Request('https://x', { method: 'GET' }), deps());
    expect(await res.json()).toEqual({ configured: true, model: VOICE_MODEL });
  });
});
