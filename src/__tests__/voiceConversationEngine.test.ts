import { describe, expect, it, vi } from 'vitest';
import { canTransition } from '../services/voice/conversationStateMachine';
import { CONVERSATION_LIMITS, createVoiceConversationEngine, type ConversationDeps } from '../services/voice/voiceConversationEngine';
import { isLikelyEcho, matchWakePhrase } from '../services/voice/utterances';
import type { ListeningHandlers } from '../types/voice';

function setup(config: Partial<{ handsFree: boolean; wakePhrase: boolean; bargeIn: boolean; maxDurationMs: number }> = {}) {
  let clock = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const listens: ListeningHandlers[] = [];
  const aborts: ReturnType<typeof vi.fn>[] = [];
  const spoken: { text: string; onStart: () => void; onEnd: () => void }[] = [];
  const states: string[] = [];
  const deps = {
    recognizer: {
      isSupported: vi.fn(() => true),
      requestMicrophone: vi.fn(async () => undefined),
      startListening: vi.fn((handlers: ListeningHandlers) => {
        listens.push(handlers);
        const abort = vi.fn();
        aborts.push(abort);
        return { stop: vi.fn(), abort };
      }),
    },
    output: {
      speak: vi.fn((text: string, cb: { onStart: () => void; onEnd: () => void }) => spoken.push({ text, ...cb })),
      stop: vi.fn(),
    },
    handleTurn: vi.fn(async () => undefined) as ConversationDeps['handleTurn'] & ReturnType<typeof vi.fn>,
    cancelPending: vi.fn(),
    onState: vi.fn((s: string) => states.push(s)),
    onInterim: vi.fn(),
    onNotice: vi.fn((kind: string) => `notice ${kind}`),
    onMetrics: vi.fn(),
    onEnd: vi.fn(),
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimer: (h: unknown) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const engine = createVoiceConversationEngine(deps, {
    handsFree: true,
    wakePhrase: false,
    bargeIn: false,
    maxDurationMs: 60_000,
    ...config,
  });
  const advance = (ms: number) => {
    const target = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      clock = next.at;
      next.fn();
    }
    clock = target;
  };
  const lastListen = () => listens[listens.length - 1];
  const finishSpeech = () => {
    const s = spoken[spoken.length - 1];
    s.onStart();
    s.onEnd();
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { engine, deps, listens, aborts, spoken, states, advance, lastListen, finishSpeech, flush };
}

async function started(config?: Parameters<typeof setup>[0]) {
  const t = setup(config);
  await t.engine.start('Welcome');
  t.finishSpeech();
  t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
  return t;
}

describe('conversation state machine', () => {
  it('allows only defined transitions', () => {
    expect(canTransition('idle', 'starting')).toBe(true);
    expect(canTransition('idle', 'listening')).toBe(false);
    expect(canTransition('stopped', 'listening')).toBe(false);
    expect(canTransition('assistant-speaking', 'interrupted')).toBe(true);
    expect(canTransition('error', 'processing')).toBe(false);
  });
});

describe('voice conversation engine', () => {
  it('asks for the microphone, speaks the welcome, then listens', async () => {
    const t = await started();
    expect(t.deps.recognizer.requestMicrophone).toHaveBeenCalledTimes(1);
    expect(t.spoken[0].text).toBe('Welcome');
    expect(t.engine.state).toBe('listening');
    expect(t.states.slice(0, 3)).toEqual(['starting', 'assistant-speaking', 'listening']);
  });

  it('stops cleanly when microphone permission is denied', async () => {
    const t = setup();
    t.deps.recognizer.requestMicrophone.mockRejectedValueOnce('permission-denied');
    expect(await t.engine.start('Welcome')).toBe(false);
    expect(t.deps.onEnd).toHaveBeenCalledWith('permission-denied');
    expect(t.engine.active).toBe(false);
    expect(t.deps.recognizer.startListening).not.toHaveBeenCalled();
  });

  it('reports unsupported browsers without touching the microphone', async () => {
    const t = setup();
    t.deps.recognizer.isSupported.mockReturnValue(false);
    expect(await t.engine.start('Welcome')).toBe(false);
    expect(t.deps.onEnd).toHaveBeenCalledWith('unsupported');
    expect(t.deps.recognizer.requestMicrophone).not.toHaveBeenCalled();
  });

  it('handles a turn, speaks the answer and listens again hands-free', async () => {
    const t = await started();
    t.deps.handleTurn.mockImplementationOnce(async () => {
      t.engine.say('A table with a red bottle.', 'reply');
    });
    t.lastListen().onInterim?.('what is');
    t.lastListen().onFinal('What is in front of me?');
    await t.flush();
    expect(t.deps.handleTurn).toHaveBeenCalledWith('What is in front of me?', expect.objectContaining({ turnId: 1 }));
    expect(t.engine.state).toBe('assistant-speaking');
    const before = t.listens.length;
    t.finishSpeech();
    t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
    expect(t.listens.length).toBe(before + 1);
    expect(t.engine.state).toBe('listening');
    expect(t.deps.onMetrics).toHaveBeenCalledWith(expect.objectContaining({ turnId: 1 }));
  });

  it('waits for a tap after each reply when hands-free is off', async () => {
    const t = setup({ handsFree: false });
    await t.engine.start('Welcome');
    t.finishSpeech();
    expect(t.engine.state).toBe('waiting');
    expect(t.deps.recognizer.startListening).not.toHaveBeenCalled();
    t.engine.interrupt();
    expect(t.engine.state).toBe('listening');
  });

  it('switches to tap-to-talk after several silent rounds', async () => {
    const t = await started();
    for (let i = 0; i < CONVERSATION_LIMITS.maxSilentRounds; i++) {
      t.lastListen().onEnd();
      t.advance(CONVERSATION_LIMITS.restartDelayMs);
    }
    expect(t.deps.onNotice).toHaveBeenCalledWith('stopped-listening', null);
    expect(t.spoken[t.spoken.length - 1].text).toBe('notice stopped-listening');
    t.finishSpeech();
    t.advance(1000);
    expect(t.engine.state).toBe('waiting');
  });

  it('falls back to tap-to-talk when recognition keeps failing', async () => {
    const t = await started();
    for (let i = 0; i < CONVERSATION_LIMITS.maxRecognitionFailures; i++) {
      t.lastListen().onError('network');
      t.lastListen().onEnd();
      t.advance(CONVERSATION_LIMITS.restartDelayMs * 2);
    }
    expect(t.deps.onNotice).toHaveBeenCalledWith('recognition-unreliable', 'network');
    expect(t.engine.handsFreeAvailable).toBe(false);
  });

  it('ends the session when permission is revoked during listening', async () => {
    const t = await started();
    t.lastListen().onError('permission-denied');
    t.lastListen().onEnd();
    expect(t.deps.onEnd).toHaveBeenCalledWith('permission-denied');
    expect(t.engine.active).toBe(false);
  });

  it('the Talk button stops speech, cancels the pending answer and never speaks the stale reply', async () => {
    const t = await started();
    let release: () => void = () => undefined;
    let staleSignal: AbortSignal | null = null;
    t.deps.handleTurn.mockImplementationOnce(
      (_text: string, ctx: { signal: AbortSignal }) =>
        new Promise<void>((resolve) => {
          staleSignal = ctx.signal;
          release = () => {
            if (!ctx.signal.aborted) t.engine.say('stale answer', 'reply');
            resolve();
          };
        }),
    );
    t.lastListen().onFinal('Describe the room');
    await t.flush();
    expect(t.engine.state).toBe('processing');
    t.engine.interrupt();
    expect(t.deps.output.stop).toHaveBeenCalled();
    expect(t.deps.cancelPending).toHaveBeenCalled();
    expect(staleSignal!.aborted).toBe(true);
    expect(t.engine.state).toBe('listening');
    release();
    await t.flush();
    expect(t.spoken.map((s) => s.text)).not.toContain('stale answer');
  });

  it('ignores late recognition results from an earlier listening round', async () => {
    const t = await started();
    const old = t.lastListen();
    t.engine.say('Status', 'status');
    old.onFinal('late words');
    await t.flush();
    expect(t.deps.handleTurn).not.toHaveBeenCalled();
  });

  it('drops automatic descriptions while busy but speaks them while listening', async () => {
    const t = await started();
    t.deps.handleTurn.mockImplementationOnce(() => new Promise<void>(() => undefined));
    t.lastListen().onFinal('Hello');
    await t.flush();
    expect(t.engine.say('auto view', 'auto')).toBe(true);
    expect(t.spoken.map((s) => s.text)).not.toContain('auto view');
  });

  it('does not route speech when the session is not running', () => {
    const t = setup();
    expect(t.engine.say('hello', 'reply')).toBe(false);
    expect(t.engine.hush()).toBe(false);
  });

  it('experimental barge-in interrupts with real speech but ignores its own echo', async () => {
    const t = await started({ bargeIn: true });
    t.deps.handleTurn.mockImplementationOnce(async () => {
      t.engine.say('There is a red bottle on the table.', 'reply');
    });
    t.lastListen().onFinal('What is on the table?');
    await t.flush();
    const barge = t.lastListen();
    barge.onFinal('a red bottle on the table');
    await t.flush();
    expect(t.deps.handleTurn).toHaveBeenCalledTimes(1);
    barge.onFinal('what color is the cap');
    await t.flush();
    expect(t.deps.output.stop).toHaveBeenCalled();
    expect(t.deps.handleTurn).toHaveBeenLastCalledWith('what color is the cap', expect.anything());
  });

  it('wake phrase: ignores unaddressed speech and handles "Hey OpenEyes" requests', async () => {
    const t = setup({ wakePhrase: true });
    await t.engine.start('Welcome');
    t.finishSpeech();
    t.advance(CONVERSATION_LIMITS.wakeWindowMs + 1000);
    t.lastListen().onFinal('so I told her about it');
    await t.flush();
    expect(t.deps.handleTurn).not.toHaveBeenCalled();
    t.advance(CONVERSATION_LIMITS.restartDelayMs);
    t.lastListen().onFinal('Hey OpenEyes, read the label');
    await t.flush();
    expect(t.deps.handleTurn).toHaveBeenCalledWith('read the label', expect.anything());
  });

  it('stops at the session limit and releases the microphone', async () => {
    const t = await started({ maxDurationMs: 5000 });
    t.advance(5000);
    expect(t.deps.onEnd).toHaveBeenCalledWith('session-limit');
    expect(t.aborts[t.aborts.length - 1]).toHaveBeenCalled();
    expect(t.engine.state).toBe('stopped');
  });

  it('stop cancels speech, listening and pending work', async () => {
    const t = await started();
    t.engine.stop('user');
    expect(t.deps.output.stop).toHaveBeenCalled();
    expect(t.deps.cancelPending).toHaveBeenCalled();
    expect(t.aborts[t.aborts.length - 1]).toHaveBeenCalled();
    expect(t.engine.say('x', 'reply')).toBe(false);
    t.advance(10_000);
    expect(t.deps.recognizer.startListening).toHaveBeenCalledTimes(1);
  });

  it('typed input during a session is handled as a turn', async () => {
    const t = await started();
    t.engine.submit('Find my keys');
    await t.flush();
    expect(t.deps.handleTurn).toHaveBeenCalledWith('Find my keys', expect.anything());
  });
});

describe('hands-free conversation (Phase 4.1)', () => {
  async function ask(t: Awaited<ReturnType<typeof started>>, question: string, answer: string) {
    t.deps.handleTurn.mockImplementationOnce(async () => {
      t.engine.say(answer, 'reply');
    });
    t.advance(500);
    t.lastListen().onInterim?.(question.slice(0, 6));
    t.advance(900);
    t.lastListen().onFinal(question);
    await t.flush();
  }

  it('answers two questions in a row with no tap, listening again only after speech ends', async () => {
    const t = await started();
    await ask(t, "What's around me?", 'A kitchen with a table.');
    expect(t.engine.state).toBe('assistant-speaking');
    t.spoken[t.spoken.length - 1].onStart();
    t.advance(5000);
    expect(t.engine.state).toBe('assistant-speaking');
    t.spoken[t.spoken.length - 1].onEnd();
    t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
    expect(t.engine.state).toBe('listening');

    await ask(t, "What's on my left?", 'A window.');
    expect(t.deps.handleTurn).toHaveBeenNthCalledWith(2, "What's on my left?", expect.anything());
    t.finishSpeech();
    t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
    expect(t.engine.state).toBe('listening');
  });

  it('never has two microphone sessions open: each new round aborts the previous one', async () => {
    const t = await started();
    await ask(t, 'Read this sign', 'It says exit.');
    expect(t.aborts.slice(0, -1).every((a) => a.mock.calls.length > 0)).toBe(true);
    t.finishSpeech();
    t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
    expect(t.aborts.slice(0, -1).every((a) => a.mock.calls.length > 0)).toBe(true);
    expect(t.aborts[t.aborts.length - 1]).not.toHaveBeenCalled();
  });

  it('stop during speech: a late speech end and late recognition events do not restart listening', async () => {
    const t = await started();
    const oldListen = t.lastListen();
    await ask(t, 'Describe the room', 'A long description.');
    const reply = t.spoken[t.spoken.length - 1];
    t.engine.stop('user');
    const count = t.listens.length;
    reply.onStart();
    reply.onEnd();
    oldListen.onFinal('ghost words');
    oldListen.onEnd();
    t.advance(10_000);
    expect(t.listens.length).toBe(count);
    expect(t.engine.state).toBe('stopped');
    expect(t.deps.handleTurn).toHaveBeenCalledTimes(1);
  });

  it('the Talk button still interrupts a reply and opens the microphone', async () => {
    const t = await started();
    await ask(t, 'Describe the room', 'A long description.');
    const count = t.listens.length;
    t.engine.interrupt();
    t.advance(1000);
    expect(t.deps.output.stop).toHaveBeenCalled();
    expect(t.listens.length).toBeGreaterThan(count);
    expect(['listening', 'user-speaking']).toContain(t.engine.state);
  });

  it('reports first words, reply, playback and resume timings without any words', async () => {
    const t = await started();
    await ask(t, 'What is here?', 'A chair.');
    const reply = t.spoken[t.spoken.length - 1];
    reply.onStart();
    t.advance(2000);
    reply.onEnd();
    t.advance(CONVERSATION_LIMITS.afterSpeechDelayMs);
    const calls = t.deps.onMetrics.mock.calls;
    const last = calls[calls.length - 1]?.[0];
    expect(last).toMatchObject({
      turnId: 1,
      firstTranscriptMs: 500,
      recognitionMs: 900,
      playbackMs: 2000,
      resumeListeningMs: CONVERSATION_LIMITS.afterSpeechDelayMs,
    });
    expect(JSON.stringify(last)).not.toContain('chair');
  });
});

describe('utterance helpers', () => {
  it('matches the wake phrase in common spellings', () => {
    expect(matchWakePhrase('Hey OpenEyes, what is this?')).toEqual({ matched: true, rest: 'what is this?' });
    expect(matchWakePhrase('hey open eyes').matched).toBe(true);
    expect(matchWakePhrase('open-eyes read this').rest).toBe('read this');
    expect(matchWakePhrase('my eyes are tired').matched).toBe(false);
  });

  it('detects the assistant hearing itself', () => {
    expect(isLikelyEcho('red bottle on the table', 'There is a red bottle on the table.')).toBe(true);
    expect(isLikelyEcho('what color is the cap', 'There is a red bottle on the table.')).toBe(false);
  });
});
