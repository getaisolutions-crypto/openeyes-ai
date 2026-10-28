import type { ListeningHandlers, ListeningSession, SpeechErrorKind } from '../../types/voice';
import { canTransition, type ConversationState } from './conversationStateMachine';
import { isLikelyEcho, matchWakePhrase } from './utterances';

export interface RecognizerPort {
  isSupported(): boolean;
  /** Asks for microphone permission. Rejects with a SpeechErrorKind. */
  requestMicrophone(): Promise<void>;
  startListening(handlers: ListeningHandlers): ListeningSession;
}

export interface SpeechOutputPort {
  speak(text: string, callbacks: { onStart: () => void; onEnd: () => void }): void;
  stop(): void;
}

export interface TurnContext {
  turnId: number;
  signal: AbortSignal;
}

export interface TurnMetrics {
  turnId: number;
  /** From the microphone opening to the first words being recognized. */
  firstTranscriptMs: number | null;
  /** From the first words heard to the final transcript. */
  recognitionMs: number | null;
  /** From the final transcript to the first reply being ready. */
  responseMs: number | null;
  /** From asking the voice to speak to audio starting. */
  playbackStartMs: number | null;
  /** From the final transcript to audio starting. */
  endToEndMs: number | null;
  /** How long the spoken reply played. */
  playbackMs: number | null;
  /** From the reply finishing to the microphone listening again. */
  resumeListeningMs: number | null;
}

type TurnTracking = TurnMetrics & { heardAt: number; speakAt: number | null; replyUid: number | null; playingAt: number | null; endedAt: number | null };

export type ConversationEndReason =
  | 'user'
  | 'command'
  | 'session-limit'
  | 'hidden'
  | 'permission-denied'
  | 'microphone-unavailable'
  | 'unsupported'
  | 'unmount';

export type ConversationNotice = 'stopped-listening' | 'recognition-unreliable';

export interface ConversationDeps {
  recognizer: RecognizerPort;
  output: SpeechOutputPort;
  handleTurn(text: string, context: TurnContext): Promise<void>;
  /** Cancels any AI request still running for an earlier turn. */
  cancelPending(): void;
  onState(state: ConversationState, info: { bargeInListening: boolean }): void;
  onInterim(text: string): void;
  onNotice(kind: ConversationNotice, error: SpeechErrorKind | null): string;
  onMetrics(metrics: TurnMetrics): void;
  onEnd(reason: ConversationEndReason): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ConversationConfig {
  /** Listen again automatically after each reply. Off means tap-to-talk for every turn. */
  handsFree: boolean;
  /** Experimental: requests must start with "Hey OpenEyes" unless they follow a reply closely. */
  wakePhrase: boolean;
  /** Experimental: keep the microphone on while OpenEyes speaks so the user can talk over it. */
  bargeIn: boolean;
  maxDurationMs: number;
}

export const CONVERSATION_LIMITS = {
  /** Silent listening rounds before switching to tap-to-talk; Android plays a tone every round. */
  maxSilentRounds: 3,
  /** Recognition failures in a row before hands-free listening is considered unreliable. */
  maxRecognitionFailures: 2,
  restartDelayMs: 300,
  /** Pause after speech so the tail of the audio is not picked up by the microphone. */
  afterSpeechDelayMs: 400,
  /** Follow-up window after a reply in which the wake phrase is not needed. */
  wakeWindowMs: 8000,
  maxBargeInRestarts: 3,
} as const;

export function createVoiceConversationEngine(deps: ConversationDeps, initialConfig: ConversationConfig) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let config = { ...initialConfig };
  let state: ConversationState = 'idle';
  let active = false;
  let session: ListeningSession | null = null;
  let listenId = 0;
  let lastError: SpeechErrorKind | null = null;
  let silentRounds = 0;
  let failures = 0;
  let unreliable = false;
  /** Stay in tap-to-talk after a notice, until the user taps Talk again. */
  let parked = false;
  let listenTimer: unknown = null;
  let sessionTimer: unknown = null;
  let speechStartedAt: number | null = null;

  let turnId = 0;
  let turnAbort: AbortController | null = null;
  let pending = false;

  let utteranceId = 0;
  let spokenText = '';
  let bargeSession: ListeningSession | null = null;
  let bargeRestarts = 0;
  let awakeUntil = 0;

  let metrics: TurnTracking | null = null;
  let listenStartedAt = 0;

  const emitState = () => deps.onState(state, { bargeInListening: Boolean(bargeSession) });

  function transition(to: ConversationState): boolean {
    if (state === to) return true;
    if (!canTransition(state, to)) return false;
    state = to;
    emitState();
    return true;
  }

  function sendMetrics() {
    if (!metrics) return;
    const { turnId: id, firstTranscriptMs, recognitionMs, responseMs, playbackStartMs, endToEndMs, playbackMs, resumeListeningMs } = metrics;
    deps.onMetrics({ turnId: id, firstTranscriptMs, recognitionMs, responseMs, playbackStartMs, endToEndMs, playbackMs, resumeListeningMs });
  }

  function clearListenTimer() {
    if (listenTimer !== null) clearTimer(listenTimer);
    listenTimer = null;
  }

  function stopRecognition() {
    clearListenTimer();
    listenId++;
    session?.abort();
    session = null;
  }

  function stopBargeIn() {
    const s = bargeSession;
    bargeSession = null;
    s?.abort();
  }

  function cancelTurn() {
    turnId++;
    pending = false;
    turnAbort?.abort();
    turnAbort = null;
    deps.cancelPending();
  }

  function silenceSpeech() {
    utteranceId++;
    stopBargeIn();
    deps.output.stop();
  }

  function toWaiting(notice: ConversationNotice, error: SpeechErrorKind | null) {
    stopRecognition();
    if (!transition('waiting')) return;
    parked = true;
    const message = deps.onNotice(notice, error);
    if (message) speak(message, false);
  }

  function scheduleListen(delay: number) {
    clearListenTimer();
    listenTimer = setTimer(() => {
      listenTimer = null;
      listen();
    }, delay);
  }

  function resumeAfterTurn(delay: number) {
    if (!active) return;
    if (config.handsFree && !unreliable && !parked) {
      awakeUntil = now() + delay + CONVERSATION_LIMITS.wakeWindowMs;
      scheduleListen(delay);
    } else {
      transition('waiting');
    }
  }

  function afterListenEnd() {
    if (!active || (state !== 'listening' && state !== 'user-speaking')) return;
    const error = lastError;
    lastError = null;
    if (error === 'permission-denied') {
      stop('permission-denied');
      return;
    }
    if (error === null || error === 'no-speech') {
      silentRounds++;
      if (silentRounds >= CONVERSATION_LIMITS.maxSilentRounds) toWaiting('stopped-listening', null);
      else scheduleListen(CONVERSATION_LIMITS.restartDelayMs);
      return;
    }
    failures++;
    if (failures >= CONVERSATION_LIMITS.maxRecognitionFailures) {
      unreliable = true;
      toWaiting('recognition-unreliable', error);
    } else {
      scheduleListen(CONVERSATION_LIMITS.restartDelayMs * 2);
    }
  }

  function listen() {
    if (!active) return;
    stopRecognition();
    if (!transition('listening')) return;
    const id = listenId;
    speechStartedAt = null;
    listenStartedAt = now();
    if (metrics && metrics.endedAt !== null && metrics.resumeListeningMs === null) {
      metrics.resumeListeningMs = listenStartedAt - metrics.endedAt;
      sendMetrics();
    }
    lastError = null;
    session = deps.recognizer.startListening({
      onInterim: (text) => {
        if (id !== listenId) return;
        if (speechStartedAt === null) speechStartedAt = now();
        if (state === 'listening') transition('user-speaking');
        deps.onInterim(text);
      },
      onFinal: (text) => {
        if (id !== listenId) return;
        heard(text);
      },
      onError: (kind) => {
        if (id !== listenId || kind === 'aborted') return;
        lastError = kind;
      },
      onEnd: () => {
        if (id !== listenId) return;
        session = null;
        afterListenEnd();
      },
    });
  }

  function heard(raw: string) {
    const text = raw.trim();
    if (!text) return;
    silentRounds = 0;
    failures = 0;
    const startedAt = speechStartedAt;
    deps.onInterim('');
    let request = text;
    if (config.wakePhrase && now() > awakeUntil) {
      const wake = matchWakePhrase(text);
      if (!wake.matched) {
        // Not addressed to OpenEyes: keep listening without answering.
        stopRecognition();
        scheduleListen(CONVERSATION_LIMITS.restartDelayMs);
        return;
      }
      if (!wake.rest) {
        stopRecognition();
        awakeUntil = now() + CONVERSATION_LIMITS.wakeWindowMs;
        speak('Yes?', false);
        return;
      }
      request = wake.rest;
    }
    stopRecognition();
    void processTurn(request, startedAt);
  }

  async function processTurn(text: string, speechStart: number | null) {
    if (!active) return;
    const id = ++turnId;
    turnAbort?.abort();
    const abort = new AbortController();
    turnAbort = abort;
    pending = true;
    const heardAt = now();
    metrics = {
      turnId: id,
      heardAt,
      speakAt: null,
      replyUid: null,
      playingAt: null,
      endedAt: null,
      firstTranscriptMs: speechStart === null ? null : speechStart - listenStartedAt,
      recognitionMs: speechStart === null ? null : heardAt - speechStart,
      responseMs: null,
      playbackStartMs: null,
      endToEndMs: null,
      playbackMs: null,
      resumeListeningMs: null,
    };
    transition('processing');
    try {
      await deps.handleTurn(text, { turnId: id, signal: abort.signal });
    } catch {
      // The handler reports its own errors; the conversation keeps going.
    }
    if (id !== turnId || !active) return;
    pending = false;
    turnAbort = null;
    if (state === 'processing') {
      if (metrics?.turnId === id && metrics.endedAt === null) {
        metrics.endedAt = now();
        sendMetrics();
      }
      resumeAfterTurn(CONVERSATION_LIMITS.restartDelayMs);
    }
  }

  function startBargeIn(uid: number) {
    if (!config.bargeIn || uid !== utteranceId) return;
    bargeSession = deps.recognizer.startListening({
      onFinal: (text) => {
        if (uid !== utteranceId || isLikelyEcho(text, spokenText)) return;
        interruptWith(text);
      },
      onError: () => undefined,
      onEnd: () => {
        if (uid !== utteranceId || !bargeSession) return;
        bargeSession = null;
        if (state === 'assistant-speaking' && bargeRestarts++ < CONVERSATION_LIMITS.maxBargeInRestarts) startBargeIn(uid);
      },
    });
    emitState();
  }

  function speak(text: string, countsAsReply: boolean) {
    stopRecognition();
    stopBargeIn();
    const uid = ++utteranceId;
    spokenText = text;
    bargeRestarts = 0;
    if (countsAsReply && metrics && metrics.speakAt === null) {
      metrics.speakAt = now();
      metrics.replyUid = uid;
      metrics.responseMs = metrics.speakAt - metrics.heardAt;
    }
    transition('assistant-speaking');
    startBargeIn(uid);
    deps.output.speak(text, {
      onStart: () => {
        if (uid !== utteranceId || !metrics || metrics.replyUid !== uid || metrics.speakAt === null || metrics.playingAt !== null) return;
        const t = now();
        metrics.playingAt = t;
        metrics.playbackStartMs = t - metrics.speakAt;
        metrics.endToEndMs = t - metrics.heardAt;
        sendMetrics();
      },
      onEnd: () => {
        if (uid !== utteranceId) return;
        stopBargeIn();
        if (!active) return;
        if (metrics && metrics.replyUid === uid && metrics.endedAt === null) {
          const t = now();
          metrics.endedAt = t;
          if (metrics.playingAt !== null) metrics.playbackMs = t - metrics.playingAt;
          sendMetrics();
        }
        if (pending) transition('processing');
        else {
          resumeAfterTurn(CONVERSATION_LIMITS.afterSpeechDelayMs);
        }
      },
    });
  }

  function interruptWith(text: string) {
    silenceSpeech();
    cancelTurn();
    transition('interrupted');
    void processTurn(text, null);
  }

  function stop(reason: ConversationEndReason) {
    if (!active) return;
    active = false;
    if (sessionTimer !== null) clearTimer(sessionTimer);
    sessionTimer = null;
    stopRecognition();
    silenceSpeech();
    cancelTurn();
    transition('stopped');
    deps.onEnd(reason);
  }

  return {
    get state() {
      return state;
    },
    get active() {
      return active;
    },
    get handsFreeAvailable() {
      return config.handsFree && !unreliable;
    },

    /** Asks for the microphone, speaks the welcome message and starts listening. */
    async start(welcome: string): Promise<boolean> {
      if (active) return true;
      if (!deps.recognizer.isSupported()) {
        deps.onEnd('unsupported');
        return false;
      }
      if (state === 'idle' || state === 'stopped') transition('starting');
      active = true;
      unreliable = false;
      parked = false;
      silentRounds = 0;
      failures = 0;
      try {
        await deps.recognizer.requestMicrophone();
      } catch (error) {
        if (!active) return false;
        active = false;
        transition('error');
        transition('stopped');
        deps.onEnd(error === 'permission-denied' ? 'permission-denied' : 'microphone-unavailable');
        return false;
      }
      if (!active) return false;
      sessionTimer = setTimer(() => stop('session-limit'), config.maxDurationMs);
      speak(welcome, false);
      return true;
    },

    stop,

    setConfig(next: Partial<ConversationConfig>) {
      config = { ...config, ...next };
    },

    /**
     * Speaks on behalf of the app while the session is running, so only one voice controls the speaker.
     * Returns false when the session is not running and the caller should speak normally.
     * Automatic descriptions are dropped unless the user is idle.
     */
    say(text: string, kind: 'reply' | 'auto' | 'status'): boolean {
      if (!active) return false;
      if (kind === 'auto' && state !== 'listening' && state !== 'waiting') return true;
      speak(text, kind === 'reply');
      return true;
    },

    /**
     * Silences OpenEyes when another part of the app needs quiet (for example Describe now).
     * Returns false when the session is not running and the caller should stop speech itself.
     */
    hush(): boolean {
      if (!active) return false;
      if (state === 'assistant-speaking') {
        silenceSpeech();
        if (pending) transition('processing');
        else resumeAfterTurn(CONVERSATION_LIMITS.restartDelayMs);
      }
      return true;
    },

    /** Talk button: stops speech, cancels the pending answer and listens right away. */
    interrupt() {
      if (!active || state === 'listening' || state === 'user-speaking') return;
      parked = false;
      silenceSpeech();
      if (pending) cancelTurn();
      transition('interrupted');
      listen();
    },

    /** Typed input during a session. */
    submit(text: string) {
      if (!active || !text.trim()) return;
      parked = false;
      silenceSpeech();
      if (pending) cancelTurn();
      stopRecognition();
      transition('interrupted');
      void processTurn(text.trim(), null);
    },
  };
}

export type VoiceConversationEngine = ReturnType<typeof createVoiceConversationEngine>;
