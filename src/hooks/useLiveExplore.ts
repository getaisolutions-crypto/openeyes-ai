import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useSettings } from './useSettings';
import { useAnnouncer } from './useAnnouncer';
import { useSpeechSynthesis } from './useSpeechSynthesis';
import { aiErrorMessage } from './useAIRequest';
import { toCameraError } from '../services/camera/browserCameraProvider';
import {
  createLiveExploreController,
  type EndReason,
  type LiveExploreController,
  type LiveStatus,
  type Observation,
} from '../services/explore/liveExploreController';
import { parseExploreCommand } from '../services/explore/exploreCommands';
import { selectRelevantMemories } from '../services/ai/conversationContext';
import { AIRequestError, type ChatMessage } from '../types/ai';
import { CameraError, type CameraErrorKind, type CapturedImage } from '../types/camera';
import type { ExploreMode } from '../types/settings';
import { describeFindResult } from '../components/FindResultCard';
import { createId } from '../utils/id';
import { formatDateTime } from '../utils/format';

export type SessionStatus = 'idle' | 'requesting' | LiveStatus | 'error';

export interface TranscriptEntry {
  id: string;
  speaker: 'you' | 'openeyes' | 'notice';
  text: string;
  /** Where the answer came from: current frame, an earlier frame, saved memories. */
  basis?: string;
  at: string;
}

export type SayKind = 'reply' | 'auto' | 'status';

/** Lets a running voice conversation own the speaker. Each method returns false when it is not running. */
export interface SpeechRouter {
  say(text: string, kind: SayKind): boolean;
  hush(): boolean;
}

export const MODE_LABELS: Record<ExploreMode, string> = {
  ask: 'Ask only',
  smart: 'Smart Explore',
  continuous: 'Continuous',
};

const START_MESSAGES: Record<ExploreMode, string> = {
  ask: 'Camera on. Live Explore started in Ask only mode. Nothing is sent until you ask. Tap the microphone and ask a question.',
  smart: 'Camera on. Live Explore started in Smart Explore mode. I will speak only when the view changes.',
  continuous: 'Camera on. Live Explore started in Continuous mode. I will describe the view regularly.',
};

const END_MESSAGES: Record<Exclude<EndReason, 'unmount'>, string> = {
  user: 'Exploring stopped. Camera off.',
  'session-limit': 'Exploring stopped because the session time or frame limit was reached. Camera off. You can start again.',
  hidden: 'Exploring stopped because OpenEyes left the screen. Camera off.',
  error: 'Exploring stopped because of a problem. Camera off.',
};

const MAX_QUESTION_CHARS = 1900;
const NEEDS_SESSION = 'Start Live Explore first so I can use the camera.';
const MAX_HISTORY_MESSAGES = 8;
const HISTORY_NOTE =
  '\n\nEarlier messages in this conversation may describe an older view. Only the attached photo shows what is in view now.';
const CAMERA_OFF_NOTE =
  '\n\n(The camera is off, so you cannot see anything right now. If answering needs sight, say so and suggest starting Live Explore. Do not guess what is around me.)';

function releaseImage(image: CapturedImage) {
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(image.previewUrl);
}

/** Builds the question with earlier observations clearly labelled as possibly out of date. */
export function buildContextualQuestion(question: string, earlier: readonly Observation[]): string {
  const lines = earlier
    .slice(0, 3)
    .map((o) => `- (${formatDateTime(o.capturedAt)}) ${o.text.replace(/\s+/g, ' ').slice(0, 400)}`);
  const content = lines.length
    ? `${question}\n\nFor context only, earlier live observations from this session (they may be out of date):\n${lines.join('\n')}`
    : question;
  return content.slice(0, MAX_QUESTION_CHARS);
}

export function useLiveExplore() {
  const { camera, vision, ai, objectDetection, memory } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const speech = useSpeechSynthesis();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controllerRef = useRef<LiveExploreController | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [cameraError, setCameraError] = useState<CameraErrorKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [pendingMemory, setPendingMemory] = useState<string | null>(null);
  const lastReplyRef = useRef<string | null>(null);
  const conversationRef = useRef(false);
  const speakingRef = useRef(false);
  const routerRef = useRef<SpeechRouter | null>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const chatAbortRef = useRef<AbortController | null>(null);

  const canSpeak = speech.supported && settings.voiceOutput && !settings.quietMode;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sayRef = useRef<(text: string, kind: 'reply' | 'auto' | 'status') => void>(() => undefined);

  const addEntry = useCallback((entry: Omit<TranscriptEntry, 'id' | 'at'>) => {
    setTranscript((prev) => [...prev.slice(-49), { ...entry, id: createId(), at: new Date().toISOString() }]);
  }, []);

  /**
   * Speaks through text-to-speech when spoken replies are on; otherwise hands the text to the screen
   * reader. Never both, so TalkBack users do not hear everything twice.
   */
  const say = useCallback(
    (text: string, kind: SayKind) => {
      if (routerRef.current?.say(text, kind)) return;
      if (kind === 'auto' && (conversationRef.current || speakingRef.current)) return;
      if (canSpeak) {
        speakingRef.current = true;
        speech.speak(text, () => {
          speakingRef.current = false;
        });
      } else {
        announce(text, kind === 'status' ? 'assertive' : 'polite');
      }
    },
    [announce, canSpeak, speech],
  );
  sayRef.current = say;

  const silence = useCallback(() => {
    if (!routerRef.current?.hush()) speech.stop();
    speakingRef.current = false;
  }, [speech]);

  const stopStream = useCallback(() => {
    camera.stop(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [camera]);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) throw new CameraError('unknown', 'The camera is not on.');
    return camera.capture(video);
  }, [camera]);

  const startSession = useCallback(async () => {
    if (controllerRef.current && controllerRef.current.status !== 'ended') return;
    setProblem(null);
    setCameraError(null);
    if (!vision.getStatus().available) {
      setProblem('Live Explore needs the Meta AI connection, which is not available in this version of the app.');
      say('Live Explore is not available because Meta AI is not connected.', 'status');
      return;
    }
    if (!camera.isSupported()) {
      setCameraError('unsupported');
      setStatus('error');
      say('This browser cannot use the camera.', 'status');
      return;
    }
    setStatus('requesting');
    announce('Asking for camera permission.');
    try {
      streamRef.current = await camera.start({ facingMode: 'environment' });
    } catch (error) {
      const kind = toCameraError(error).kind;
      setCameraError(kind);
      setStatus('error');
      say(
        kind === 'permission-denied'
          ? 'Camera permission was denied. Live Explore cannot start.'
          : 'The camera could not start. Live Explore cannot start.',
        'status',
      );
      return;
    }

    const s = settingsRef.current;
    const controller = createLiveExploreController(
      {
        captureFrame,
        describe: async (image, signal) =>
          (await vision.describeScene(image, { responseLength: 'brief', signal })).summary,
        releaseImage,
        onStatus: (next) => setStatus(next === 'ended' ? 'idle' : next),
        onObservation: (observation, decision) => {
          setLastCheckedAt(observation.capturedAt);
          setProblem(null);
          if (!decision.speak) return;
          lastReplyRef.current = observation.text;
          addEntry({ speaker: 'openeyes', text: observation.text, basis: 'Current camera view' });
          sayRef.current(observation.text, observation.source === 'auto' ? 'auto' : 'reply');
        },
        onError: (error, willRetry) => {
          const kind = error instanceof AIRequestError ? error.kind : 'unknown';
          let message = aiErrorMessage(error);
          if (error instanceof CameraError) message = 'Could not capture a frame from the camera.';
          if (kind === 'rate-limited') message = `${message} Live Explore will wait before trying again.`;
          else if (willRetry) message = `${message} Trying again with the next frame.`;
          setProblem(message);
          if (kind === 'rate-limited' || !willRetry) sayRef.current(message, 'status');
        },
        onEnd: (reason) => {
          stopStream();
          controllerRef.current = null;
          setBusyLabel(null);
          setStatus('idle');
          if (reason === 'unmount') return;
          const message = END_MESSAGES[reason];
          addEntry({ speaker: 'notice', text: message });
          silence();
          sayRef.current(message, 'status');
        },
      },
      {
        mode: s.exploreMode,
        intervalMs: s.exploreIntervalSeconds * 1000,
        maxDurationMs: s.exploreSessionMinutes * 60_000,
      },
    );
    controllerRef.current = controller;
    controller.start();
    addEntry({ speaker: 'notice', text: `Live Explore started. Mode: ${MODE_LABELS[s.exploreMode]}.` });
    say(START_MESSAGES[s.exploreMode], 'status');
  }, [addEntry, announce, camera, captureFrame, say, silence, stopStream, vision]);

  // Attach the stream once the video element is on screen.
  useEffect(() => {
    const video = videoRef.current;
    if (streamRef.current && video && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      void Promise.resolve(video.play()).catch(() => undefined);
    }
  }, [status]);

  useEffect(() => {
    controllerRef.current?.setConfig({
      mode: settings.exploreMode,
      intervalMs: settings.exploreIntervalSeconds * 1000,
      maxDurationMs: settings.exploreSessionMinutes * 60_000,
    });
  }, [settings.exploreMode, settings.exploreIntervalSeconds, settings.exploreSessionMinutes]);

  const running = status === 'live' || status === 'paused' || status === 'waiting';

  useEffect(() => {
    if (!running) return;
    const onVisibility = () => {
      if (document.hidden) controllerRef.current?.stop('hidden');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [running]);

  useEffect(
    () => () => {
      controllerRef.current?.stop('unmount');
      camera.stop(streamRef.current);
      streamRef.current = null;
    },
    [camera],
  );

  const stop = useCallback(() => controllerRef.current?.stop('user'), []);

  const pause = useCallback(() => {
    const c = controllerRef.current;
    if (!c) return;
    c.pause();
    silence();
    setBusyLabel(null);
    say('Paused. The camera stays on but nothing is sent. Say keep exploring to continue.', 'status');
  }, [say, silence]);

  const resume = useCallback(() => {
    const c = controllerRef.current;
    if (!c || c.status !== 'paused') return;
    c.resume();
    say('Exploring again.', 'status');
  }, [say]);

  const describeNow = useCallback(async () => {
    const c = controllerRef.current;
    if (!c) return;
    silence();
    setBusyLabel('Describing the current view');
    try {
      await c.describeNow();
    } finally {
      setBusyLabel(null);
    }
  }, [silence]);

  /** Runs a user request with priority over automatic descriptions. */
  const runUserTask = useCallback(
    async (label: string, task: (c: LiveExploreController, signal: AbortSignal) => Promise<void>, turnSignal?: AbortSignal) => {
      const c = controllerRef.current;
      if (turnSignal?.aborted) return;
      if (!c) {
        addEntry({ speaker: 'notice', text: NEEDS_SESSION });
        say(NEEDS_SESSION, 'reply');
        return;
      }
      silence();
      conversationRef.current = true;
      setBusyLabel(label);
      announce(`${label}.`);
      // A newer voice turn cancels this one so its answer is never spoken late.
      const onTurnAbort = () => c.cancelCurrent();
      turnSignal?.addEventListener('abort', onTurnAbort);
      try {
        await c.runExclusive((signal) => task(c, signal));
      } catch (error) {
        if (error instanceof AIRequestError && error.kind === 'cancelled') return;
        if (error instanceof Error && error.name === 'AbortError') return;
        if (turnSignal?.aborted) return;
        const message = error instanceof CameraError ? 'Could not capture a frame from the camera.' : aiErrorMessage(error);
        addEntry({ speaker: 'notice', text: message });
        say(message, 'reply');
      } finally {
        turnSignal?.removeEventListener('abort', onTurnAbort);
        conversationRef.current = false;
        setBusyLabel(null);
      }
    },
    [addEntry, announce, say, silence],
  );

  const addNotice = useCallback((text: string) => addEntry({ speaker: 'notice', text }), [addEntry]);
  const addHeard = useCallback((text: string) => addEntry({ speaker: 'you', text: text.trim() }), [addEntry]);

  /** Cancels any answer still being prepared, without announcing it. */
  const cancelPending = useCallback(() => {
    controllerRef.current?.cancelCurrent();
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setBusyLabel(null);
  }, []);

  const reply = useCallback(
    (text: string, basis: string) => {
      lastReplyRef.current = text;
      addEntry({ speaker: 'openeyes', text, basis });
      say(text, 'reply');
    },
    [addEntry, say],
  );

  const rememberExchange = useCallback((question: string, answer: string, photoAttached: boolean) => {
    const at = new Date().toISOString();
    historyRef.current = [
      ...historyRef.current,
      { id: createId(), role: 'user' as const, content: question.slice(0, MAX_QUESTION_CHARS), createdAt: at, photoAttached },
      { id: createId(), role: 'assistant' as const, content: answer.slice(0, MAX_QUESTION_CHARS), createdAt: at },
    ].slice(-MAX_HISTORY_MESSAGES);
  }, []);

  const withHistory = (content: string, photoAttached: boolean): ChatMessage[] => [
    ...historyRef.current,
    { id: createId(), role: 'user', content, createdAt: new Date().toISOString(), photoAttached },
  ];

  /** Voice conversation without the camera: answers from the conversation only and never pretends to see. */
  const chatWithoutCamera = useCallback(
    async (question: string, turnSignal?: AbortSignal) => {
      chatAbortRef.current?.abort();
      const abort = new AbortController();
      chatAbortRef.current = abort;
      const onTurnAbort = () => abort.abort();
      turnSignal?.addEventListener('abort', onTurnAbort);
      setBusyLabel('Thinking');
      announce('Thinking.');
      try {
        const saved = await memory.list().catch(() => []);
        const memories = selectRelevantMemories(saved, question).map((m) => m.text);
        const response = await ai.sendMessage({
          messages: withHistory(`${question}${CAMERA_OFF_NOTE}`.slice(0, MAX_QUESTION_CHARS), false),
          responseLength: 'brief',
          memories,
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        const text = response.message.content;
        rememberExchange(question, text, false);
        const basis = 'Conversation only, camera off';
        reply(text, memories.length ? `${basis}, plus ${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}` : basis);
      } catch (error) {
        if (abort.signal.aborted) return;
        if (error instanceof AIRequestError && error.kind === 'cancelled') return;
        const message = aiErrorMessage(error);
        addEntry({ speaker: 'notice', text: message });
        say(message, 'reply');
      } finally {
        turnSignal?.removeEventListener('abort', onTurnAbort);
        if (chatAbortRef.current === abort) {
          chatAbortRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addEntry, ai, announce, memory, rememberExchange, say],
  );

  const askQuestion = useCallback(
    (question: string, about: 'current' | 'previous', turnSignal?: AbortSignal) => {
      if (!controllerRef.current && routerRef.current) return chatWithoutCamera(question, turnSignal);
      return runUserTask('Looking and answering', async (c, signal) => {
        const earlier = [...c.history];
        const previous = about === 'previous' ? earlier[0] : undefined;
        const image = previous ? previous.image : await captureFrame();
        const saved = await memory.list().catch(() => []);
        const memories = selectRelevantMemories(saved, question).map((m) => m.text);
        const response = await ai.sendMessage({
          messages: withHistory(
            (buildContextualQuestion(question, previous ? earlier.slice(1) : earlier) + (historyRef.current.length ? HISTORY_NOTE : '')).slice(
              0,
              MAX_QUESTION_CHARS,
            ),
            true,
          ),
          responseLength: 'brief',
          image,
          memories,
          signal,
        });
        if (signal.aborted) return;
        const text = response.message.content;
        if (!previous) c.record(image, text);
        rememberExchange(question, text, true);
        const view = previous ? `Earlier camera view from ${formatDateTime(previous.capturedAt)}` : 'Current camera view';
        reply(text, memories.length ? `${view}, plus ${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}` : view);
      }, turnSignal);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai, captureFrame, chatWithoutCamera, memory, rememberExchange, reply, runUserTask],
  );

  const readSign = useCallback(
    (turnSignal?: AbortSignal) =>
      runUserTask('Reading text in view', async (c, signal) => {
        if (!vision.getStatus().available) throw new AIRequestError('not-configured', 'Text reading is not available.');
        const image = await captureFrame();
        const result = await vision.readText(image, { signal });
        if (signal.aborted) return;
        const text = result.readable ? `It says: ${result.text}` : 'I cannot find readable text in this view. Try moving closer or holding the phone steady.';
        c.record(image, text);
        reply(text, 'Current camera view');
      }, turnSignal),
    [captureFrame, reply, runUserTask, vision],
  );

  const findObject = useCallback(
    (object: string, turnSignal?: AbortSignal) =>
      runUserTask(`Looking for ${object}`, async (c, signal) => {
        if (!objectDetection.getStatus().available) throw new AIRequestError('not-configured', 'Finding objects is not available.');
        const image = await captureFrame();
        const result = await objectDetection.findObject(object, image, { signal });
        if (signal.aborted) return;
        const text = describeFindResult(result);
        c.record(image, text);
        reply(text, 'Current camera view');
      }, turnSignal),
    [captureFrame, objectDetection, reply, runUserTask],
  );

  const requestRemember = useCallback(() => {
    const last = controllerRef.current?.history[0];
    if (!last) {
      const message = 'There is nothing to remember yet. Ask me to describe the view first.';
      addEntry({ speaker: 'notice', text: message });
      say(message, 'reply');
      return;
    }
    setPendingMemory(`Observed ${formatDateTime(last.capturedAt)}: ${last.text}`.slice(0, 1000));
    announce('OpenEyes needs your confirmation before saving this memory.');
  }, [addEntry, announce, say]);

  const confirmMemory = useCallback(async () => {
    const text = pendingMemory;
    setPendingMemory(null);
    if (!text) return;
    try {
      await memory.create({ text });
      say('Saved to My Memories.', 'status');
    } catch {
      say('The memory could not be saved.', 'status');
    }
  }, [memory, pendingMemory, say]);

  const cancelMemory = useCallback(() => {
    setPendingMemory(null);
    announce('Memory not saved.');
  }, [announce]);

  const cancelCurrent = useCallback(() => {
    controllerRef.current?.cancelCurrent();
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setBusyLabel(null);
    announce('Cancelled.');
  }, [announce]);

  /**
   * Routes a spoken or typed phrase and resolves when the answer has been given. Calls onNeedsStart when the
   * camera must be switched on first. Aborting turnSignal cancels the request so its answer is never spoken.
   */
  const handleInput = useCallback(
    async (input: string, onNeedsStart: () => void, turnSignal?: AbortSignal): Promise<void> => {
      const command = parseExploreCommand(input);
      if (!command) return;
      addEntry({ speaker: 'you', text: input.trim() });
      const c = controllerRef.current;
      switch (command.type) {
        case 'start':
          if (c) await describeNow();
          else onNeedsStart();
          return;
        case 'stop':
          if (c) stop();
          else say('Live Explore is not running.', 'reply');
          return;
        case 'pause':
          if (c) pause();
          else say('Live Explore is not running.', 'reply');
          return;
        case 'resume':
          if (c?.status === 'paused') resume();
          else if (!c) onNeedsStart();
          else say('Already exploring.', 'reply');
          return;
        case 'repeat':
          if (lastReplyRef.current) say(lastReplyRef.current, 'reply');
          else if (c) await describeNow();
          else say('There is nothing to repeat yet.', 'reply');
          return;
        case 'read':
          await readSign(turnSignal);
          return;
        case 'find':
          await findObject(command.object, turnSignal);
          return;
        case 'remember':
          requestRemember();
          return;
        case 'ask':
          await askQuestion(command.question, command.about, turnSignal);
      }
    },
    [addEntry, askQuestion, describeNow, findObject, pause, readSign, requestRemember, resume, say, stop],
  );

  const setSpeechRouter = useCallback((router: SpeechRouter | null) => {
    routerRef.current = router;
  }, []);

  /** Forgets the short-term conversation; it is only ever kept in memory. */
  const clearConversation = useCallback(() => {
    historyRef.current = [];
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
  }, []);

  const setConversationActive = useCallback((active: boolean) => {
    conversationRef.current = active;
    if (active) {
      silence();
    }
  }, [silence]);

  return {
    videoRef,
    status,
    running,
    cameraError,
    problem,
    transcript,
    busyLabel,
    lastCheckedAt,
    pendingMemory,
    speech,
    startSession,
    stop,
    pause,
    resume,
    describeNow,
    handleInput,
    confirmMemory,
    cancelMemory,
    cancelCurrent,
    setConversationActive,
    setSpeechRouter,
    clearConversation,
    cancelPending,
    addNotice,
    addHeard,
    say,
  };
}
