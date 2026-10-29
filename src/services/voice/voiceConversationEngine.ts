import type { ListeningHandlers, ListeningSession, SpeechErrorKind } from '../../types/voice';
import { canTransition, type ConversationState } from './conversationStateMachine';
import { isLikelyEcho, matchWakePhrase } from './utterances';

export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface RecognizerPort {
  isSupported(): boolean;
  /** Asks for microphone permission. Rejects with a SpeechErrorKind. */
  requestMicrophone(): Promise<void>;
  startListening(handlers: ListeningHandlers): ListeningSession;
  /** Re-checks the permission when recognition reports it as blocked; Android can report that for other reasons. */
  checkPermission?(): Promise<MicrophonePermission>;
}

/** Privacy-safe lifecycle events: states, error categories and timings only, never words or audio. */
export type VoiceDiagnosticEvent =
  | { kind: 'state'; state: ConversationState }
  | { kind: 'recognition-error'; error: SpeechErrorKind }
  | { kind: 'restart'; reason: 'silence' | 'rapid-end' | 'error'; attempt: number }
  | { kind: 'resumed'; afterMs: number }
  | { kind: 'speech-error'; error: 'no-end' }
  | { kind: 'auto-description'; action: 'deferred' | 'dropped' | 'spoken' }
  | { kind: 'paused-hands-free'; reason: ConversationNotice };

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
  onDiagnostic?(event: VoiceDiagnosticEvent): void;
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
  /** Recognition errors in a row (with growing pauses) before hands-free pauses until the user taps Talk. */
  maxRecognitionFailures: 4,
  /** A round that ends this fast without hearing anything is a rapid end (Android does this right after speech output). */
  rapidEndMs: 1000,
  /** Rapid ends in a row before hands-free pauses; normal silence never pauses it. */
  maxRapidEnds: 8,
  maxRestartBackoffMs: 4000,
  restartDelayMs: 300,
  /** Pause after speech so the tail of the audio is not picked up by the microphone. */
  afterSpeechDelayMs: 400,
  /** Follow-up window after a reply in which the wake phrase is not needed. */
  wakeWindowMs: 8000,
  maxBargeInRestarts: 3,
  /** Added to a generous estimate of the speaking time before a reply whose end event never came counts as finished. */
  speechEndSlackMs: 10_000,
  /** Automatic descriptions held back while the microphone is open are dropped after this long. */
  autoDescriptionMaxAgeMs: 20_000,
} as const;

/** Upper bound for speaking time: about 7.5 characters per second, the slowest speech rate. */
export function speechDeadlineMs(text: string) {
  return (text.length / 7.5) * 1000 + CONVERSATION_LIMITS.speechEndSlackMs;
}

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
  let rapidEnds = 0;
  let failures = 0;
  let unreliable = false;
  /** Stay in tap-to-talk after a notice, until the user taps Talk again. */
  let parked = false;
  let listenTimer: unknown = null;
  let sessionTimer: unknown = null;
  let speechStartedAt: number | null = null;
  let speechTimer: unknown = null;
  let queuedAuto: { text: string; at: number } | null = null;

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

  const diag = (event: VoiceDiagnosticEvent) => deps.onDiagnostic?.(event);
  const emitState = () => deps.onState(state, { bargeInListening: Boolean(bargeSession) });

  function transition(to: ConversationState): boolean {
    if (state === to) return true;
    if (!canTransition(state, to)) return false;
    state = to;
    emitState();
    diag({ kind: 'state', state: to });
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

  function clearSpeechTimer() {
    if (speechTimer !== null) clearTimer(speechTimer);
    speechTimer = null;
  }

  function silenceSpeech() {
    clearSpeechTimer();
    utteranceId++;
    stopBargeIn();
    deps.output.stop();
  }

  function toWaiting(notice: ConversationNotice, error: SpeechErrorKind | null) {
    stopRecognition();
    if (!transition('waiting')) return;
    parked = true;
    diag({ kind: 'paused-hands-free', reason: notice });
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

  const isListening = () => state === 'listening' || state === 'user-speaking';

  function backoff(attempt: number) {
    return Math.min(CONVERSATION_LIMITS.restartDelayMs * 2 ** attempt, CONVERSATION_LIMITS.maxRestartBackoffMs);
  }

  /** Speaks a held-back automatic description between listening rounds. */
  function speakQueuedAuto(): boolean {
    const queued = queuedAuto;
    queuedAuto = null;
    if (!queued || now() - queued.at > CONVERSATION_LIMITS.autoDescriptionMaxAgeMs) return false;
    diag({ kind: 'auto-description', action: 'spoken' });
    speak(queued.text, false);
    return true;
  }

  function recognitionFailed(error: SpeechErrorKind) {
    failures++;
    if (failures >= CONVERSATION_LIMITS.maxRecognitionFailures) {
      unreliable = true;
      toWaiting('recognition-unreliable', error);
      return;
    }
    diag({ kind: 'restart', reason: 'error', attempt: failures });
    scheduleListen(backoff(failures));
  }

  async function confirmPermissionDenied() {
    const check = deps.recognizer.checkPermission;
    const id = listenId;
    const permission = check ? await check().catch(() => 'unknown' as const) : 'denied';
    if (!active || id !== listenId || !isListening()) return;
    if (permission === 'denied') stop('permission-denied');
    else recognitionFailed('permission-denied');
  }

  function afterListenEnd() {
    if (!active || !isListening()) return;
    const error = lastError;
    lastError = null;
    if (error) diag({ kind: 'recognition-error', error });
    if (error === 'permission-denied') {
      void confirmPermissionDenied();
      return;
    }
    if (error === null || error === 'no-speech') {
      // Silence is normal: keep listening. Only rounds that end at once, again and again, pause hands-free.
      const rapid = now() - listenStartedAt < CONVERSATION_LIMITS.rapidEndMs;
      rapidEnds = rapid ? rapidEnds + 1 : 0;
      if (rapidEnds >= CONVERSATION_LIMITS.maxRapidEnds) {
        unreliable = true;
        toWaiting('recognition-unreliable', null);
        return;
      }
      if (speechStartedAt === null && speakQueuedAuto()) return;
      diag({ kind: 'restart', reason: rapid ? 'rapid-end' : 'silence', attempt: rapidEnds });
      scheduleListen(rapid ? backoff(rapidEnds) : CONVERSATION_LIMITS.restartDelayMs);
      return;
    }
    recognitionFailed(error);
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
      diag({ kind: 'resumed', afterMs: metrics.resumeListeningMs });
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
    rapidEnds = 0;
    failures = 0;
    queuedAuto = null;
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
    let finished = false;
    const onEnd = () => {
      if (uid !== utteranceId || finished) return;
      finished = true;
      clearSpeechTimer();
      stopBargeIn();
      if (!active) return;
      if (metrics && metrics.replyUid === uid && metrics.endedAt === null) {
        const t = now();
        metrics.endedAt = t;
        if (metrics.playingAt !== null) metrics.playbackMs = t - metrics.playingAt;
        sendMetrics();
      }
      if (pending) transition('processing');
      else resumeAfterTurn(CONVERSATION_LIMITS.afterSpeechDelayMs);
    };
    clearSpeechTimer();
    // The end event can be lost on Android or audio may never start; never leave the microphone off for good.
    speechTimer = setTimer(() => {
      speechTimer = null;
      if (uid !== utteranceId || finished) return;
      diag({ kind: 'speech-error', error: 'no-end' });
      deps.output.stop();
      onEnd();
    }, speechDeadlineMs(text));
    deps.output.speak(text, {
      onEnd,
      onStart: () => {
        if (uid !== utteranceId || !metrics || metrics.replyUid !== uid || metrics.speakAt === null || metrics.playingAt !== null) return;
        const t = now();
        metrics.playingAt = t;
        metrics.playbackStartMs = t - metrics.speakAt;
        metrics.endToEndMs = t - metrics.heardAt;
        sendMetrics();
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
    queuedAuto = null;
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
      rapidEnds = 0;
      failures = 0;
      queuedAuto = null;
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
     * Automatic descriptions never cut off an open microphone: while listening they wait for a quiet moment
     * between listening rounds, and they are dropped while the user speaks or a request is running.
     */
    say(text: string, kind: 'reply' | 'auto' | 'status'): boolean {
      if (!active) return false;
      if (kind === 'auto') {
        if (state === 'waiting') {
          diag({ kind: 'auto-description', action: 'spoken' });
          speak(text, false);
        } else if (state === 'listening') {
          queuedAuto = { text, at: now() };
          diag({ kind: 'auto-description', action: 'deferred' });
        } else {
          diag({ kind: 'auto-description', action: 'dropped' });
        }
        return true;
      }
      queuedAuto = null;
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
      if (!active || isListening()) return;
      // Tapping Talk turns hands-free back on after it paused.
      parked = false;
      unreliable = false;
      failures = 0;
      rapidEnds = 0;
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
