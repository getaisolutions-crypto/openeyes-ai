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
import { AIRequestError } from '../types/ai';
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
    (text: string, kind: 'reply' | 'auto' | 'status') => {
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
          speech.stop();
          speakingRef.current = false;
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
  }, [addEntry, announce, camera, captureFrame, say, speech, stopStream, vision]);

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
    speech.stop();
    speakingRef.current = false;
    setBusyLabel(null);
    say('Paused. The camera stays on but nothing is sent. Say keep exploring to continue.', 'status');
  }, [say, speech]);

  const resume = useCallback(() => {
    const c = controllerRef.current;
    if (!c || c.status !== 'paused') return;
    c.resume();
    say('Exploring again.', 'status');
  }, [say]);

  const describeNow = useCallback(async () => {
    const c = controllerRef.current;
    if (!c) return;
    speech.stop();
    speakingRef.current = false;
    setBusyLabel('Describing the current view');
    try {
      await c.describeNow();
    } finally {
      setBusyLabel(null);
    }
  }, [speech]);

  /** Runs a user request with priority over automatic descriptions. */
  const runUserTask = useCallback(
    async (label: string, task: (c: LiveExploreController, signal: AbortSignal) => Promise<void>) => {
      const c = controllerRef.current;
      if (!c) {
        addEntry({ speaker: 'notice', text: NEEDS_SESSION });
        say(NEEDS_SESSION, 'reply');
        return;
      }
      speech.stop();
      speakingRef.current = false;
      conversationRef.current = true;
      setBusyLabel(label);
      announce(`${label}.`);
      try {
        await c.runExclusive((signal) => task(c, signal));
      } catch (error) {
        if (error instanceof AIRequestError && error.kind === 'cancelled') return;
        if (error instanceof Error && error.name === 'AbortError') return;
        const message = error instanceof CameraError ? 'Could not capture a frame from the camera.' : aiErrorMessage(error);
        addEntry({ speaker: 'notice', text: message });
        say(message, 'reply');
      } finally {
        conversationRef.current = false;
        setBusyLabel(null);
      }
    },
    [addEntry, announce, say, speech],
  );

  const reply = useCallback(
    (text: string, basis: string) => {
      lastReplyRef.current = text;
      addEntry({ speaker: 'openeyes', text, basis });
      say(text, 'reply');
    },
    [addEntry, say],
  );

  const askQuestion = useCallback(
    (question: string, about: 'current' | 'previous') =>
      runUserTask('Looking and answering', async (c, signal) => {
        const earlier = [...c.history];
        const previous = about === 'previous' ? earlier[0] : undefined;
        const image = previous ? previous.image : await captureFrame();
        const saved = await memory.list().catch(() => []);
        const memories = selectRelevantMemories(saved, question).map((m) => m.text);
        const response = await ai.sendMessage({
          messages: [
            {
              id: createId(),
              role: 'user',
              content: buildContextualQuestion(question, previous ? earlier.slice(1) : earlier),
              createdAt: new Date().toISOString(),
              photoAttached: true,
            },
          ],
          responseLength: 'brief',
          image,
          memories,
          signal,
        });
        if (signal.aborted) return;
        const text = response.message.content;
        if (!previous) c.record(image, text);
        const view = previous ? `Earlier camera view from ${formatDateTime(previous.capturedAt)}` : 'Current camera view';
        reply(text, memories.length ? `${view}, plus ${memories.length} saved ${memories.length === 1 ? 'memory' : 'memories'}` : view);
      }),
    [ai, captureFrame, memory, reply, runUserTask],
  );

  const readSign = useCallback(
    () =>
      runUserTask('Reading text in view', async (c, signal) => {
        if (!vision.getStatus().available) throw new AIRequestError('not-configured', 'Text reading is not available.');
        const image = await captureFrame();
        const result = await vision.readText(image, { signal });
        if (signal.aborted) return;
        const text = result.readable ? `It says: ${result.text}` : 'I cannot find readable text in this view. Try moving closer or holding the phone steady.';
        c.record(image, text);
        reply(text, 'Current camera view');
      }),
    [captureFrame, reply, runUserTask, vision],
  );

  const findObject = useCallback(
    (object: string) =>
      runUserTask(`Looking for ${object}`, async (c, signal) => {
        if (!objectDetection.getStatus().available) throw new AIRequestError('not-configured', 'Finding objects is not available.');
        const image = await captureFrame();
        const result = await objectDetection.findObject(object, image, { signal });
        if (signal.aborted) return;
        const text = describeFindResult(result);
        c.record(image, text);
        reply(text, 'Current camera view');
      }),
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
    setBusyLabel(null);
    announce('Cancelled.');
  }, [announce]);

  /** Routes a spoken or typed phrase. Calls onNeedsStart when the camera must be switched on first. */
  const handleInput = useCallback(
    (input: string, onNeedsStart: () => void) => {
      const command = parseExploreCommand(input);
      if (!command) return;
      addEntry({ speaker: 'you', text: input.trim() });
      const c = controllerRef.current;
      switch (command.type) {
        case 'start':
          if (c) void describeNow();
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
          else if (c) void describeNow();
          else say('There is nothing to repeat yet.', 'reply');
          return;
        case 'read':
          void readSign();
          return;
        case 'find':
          void findObject(command.object);
          return;
        case 'remember':
          requestRemember();
          return;
        case 'ask':
          void askQuestion(command.question, command.about);
      }
    },
    [addEntry, askQuestion, describeNow, findObject, pause, readSign, requestRemember, resume, say, stop],
  );

  const setConversationActive = useCallback((active: boolean) => {
    conversationRef.current = active;
    if (active) {
      speech.stop();
      speakingRef.current = false;
    }
  }, [speech]);

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
  };
}
