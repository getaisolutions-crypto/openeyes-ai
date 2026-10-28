import { AIRequestError } from '../../types/ai';
import type { CapturedImage } from '../../types/camera';
import { assessChange, SIMILARITY_THRESHOLD, type ChangeDecision } from './descriptionManager';
import type { ExploreMode } from '../../types/settings';

/** Continuous mode speaks every new description and only skips near-identical repeats. */
const CONTINUOUS_THRESHOLD = 0.8;

export const LIVE_EXPLORE_LIMITS = {
  minIntervalMs: 8000,
  historySize: 5,
  maxConsecutiveFailures: 3,
  defaultRateLimitBackoffMs: 60_000,
  /** Fewer frames than the server quota (90 per 10 minutes) so questions still get through. */
  maxFramesPerSession: 60,
} as const;

export interface Observation {
  id: number;
  text: string;
  capturedAt: string;
  /** Kept in memory only, so the user can ask about something seen a moment ago. Never saved. */
  image: CapturedImage;
  source: 'auto' | 'requested';
}

export type LiveStatus = 'idle' | 'live' | 'paused' | 'waiting' | 'ended';
export type EndReason = 'user' | 'session-limit' | 'hidden' | 'error' | 'unmount';

export interface LiveExploreDeps {
  captureFrame(): Promise<CapturedImage>;
  describe(image: CapturedImage, signal: AbortSignal): Promise<string>;
  releaseImage(image: CapturedImage): void;
  onObservation(observation: Observation, decision: ChangeDecision): void;
  onStatus(status: LiveStatus): void;
  onError(error: unknown, willRetry: boolean): void;
  onEnd(reason: EndReason): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface LiveExploreConfig {
  mode: ExploreMode;
  intervalMs: number;
  maxDurationMs: number;
  maxFrames?: number;
}

/**
 * Runs the frame-analysis loop: one request at a time, the next frame is only scheduled after
 * the previous answer arrives, nothing runs while paused, and every request is cancelled on stop.
 */
export function createLiveExploreController(deps: LiveExploreDeps, initial: LiveExploreConfig) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let config = { ...initial };
  let status: LiveStatus = 'idle';
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let exclusive = false;
  let startedAt = 0;
  let frames = 0;
  let failures = 0;
  let nextId = 1;
  const history: Observation[] = [];

  const interval = () => Math.max(LIVE_EXPLORE_LIMITS.minIntervalMs, config.intervalMs);
  const maxFrames = () => config.maxFrames ?? LIVE_EXPLORE_LIMITS.maxFramesPerSession;
  const active = () => status === 'live' || status === 'waiting';

  function setStatus(next: LiveStatus) {
    if (status === next) return;
    status = next;
    deps.onStatus(next);
  }

  function clearSchedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms = interval()) {
    clearSchedule();
    if (config.mode === 'ask' || !active() || exclusive) return;
    timer = setTimer(() => {
      timer = null;
      void analyze('auto');
    }, ms);
  }

  function limitReached() {
    return frames >= maxFrames() || now() - startedAt >= config.maxDurationMs;
  }

  function remember(observation: Observation) {
    history.unshift(observation);
    while (history.length > LIVE_EXPLORE_LIMITS.historySize) {
      const dropped = history.pop();
      if (dropped) deps.releaseImage(dropped.image);
    }
  }

  async function analyze(source: Observation['source']): Promise<Observation | null> {
    if (!active() || inFlight) return null;
    if (limitReached()) {
      end('session-limit');
      return null;
    }
    const controller = new AbortController();
    inFlight = controller;
    let image: CapturedImage | null = null;
    try {
      image = await deps.captureFrame();
      if (controller.signal.aborted) throw new AIRequestError('cancelled', 'Cancelled.');
      frames++;
      const text = await deps.describe(image, controller.signal);
      if (controller.signal.aborted) throw new AIRequestError('cancelled', 'Cancelled.');
      failures = 0;
      const recent = history.map((o) => o.text);
      const observation: Observation = { id: nextId++, text, capturedAt: image.capturedAt, image, source };
      image = null;
      remember(observation);
      const decision =
        source === 'requested'
          ? { speak: true, reason: 'changed' as const }
          : assessChange(text, recent, config.mode === 'continuous' ? CONTINUOUS_THRESHOLD : SIMILARITY_THRESHOLD);
      deps.onObservation(observation, decision);
      if (status === 'waiting') setStatus('live');
      return observation;
    } catch (error) {
      if (image) deps.releaseImage(image);
      if (controller.signal.aborted || (error instanceof AIRequestError && error.kind === 'cancelled')) return null;
      handleFailure(error);
      return null;
    } finally {
      if (inFlight === controller) inFlight = null;
      if (active() && status !== 'waiting') schedule();
    }
  }

  function handleFailure(error: unknown) {
    const kind = error instanceof AIRequestError ? error.kind : 'unknown';
    if (kind === 'rate-limited') {
      const wait = error instanceof AIRequestError && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : LIVE_EXPLORE_LIMITS.defaultRateLimitBackoffMs;
      deps.onError(error, config.mode !== 'ask');
      setStatus('waiting');
      clearSchedule();
      timer = setTimer(() => {
        timer = null;
        if (status === 'waiting') {
          setStatus('live');
          schedule(0);
        }
      }, Math.max(wait, interval()));
      return;
    }
    if (kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'bad-response' || kind === 'unknown') {
      failures++;
      const giveUp = failures >= LIVE_EXPLORE_LIMITS.maxConsecutiveFailures;
      deps.onError(error, !giveUp && config.mode !== 'ask');
      if (giveUp) end('error');
      return;
    }
    deps.onError(error, false);
    end('error');
  }

  function end(reason: EndReason) {
    if (status === 'idle' || status === 'ended') return;
    clearSchedule();
    inFlight?.abort();
    inFlight = null;
    history.splice(0).forEach((o) => deps.releaseImage(o.image));
    setStatus('ended');
    deps.onEnd(reason);
  }

  return {
    get status() {
      return status;
    },
    get history(): readonly Observation[] {
      return history;
    },
    get busy() {
      return inFlight !== null || exclusive;
    },
    get framesAnalyzed() {
      return frames;
    },
    start() {
      if (active() || status === 'paused') return;
      startedAt = now();
      frames = 0;
      failures = 0;
      setStatus('live');
      if (config.mode !== 'ask') schedule(0);
    },
    pause() {
      if (!active()) return;
      clearSchedule();
      inFlight?.abort();
      inFlight = null;
      setStatus('paused');
    },
    resume() {
      if (status !== 'paused') return;
      setStatus('live');
      schedule(0);
    },
    stop(reason: EndReason = 'user') {
      end(reason);
    },
    setConfig(next: Partial<LiveExploreConfig>) {
      config = { ...config, ...next };
      if (active() && !inFlight) schedule();
    },
    /** Analyze a fresh frame now, at the user's request. */
    describeNow() {
      if (status === 'paused') setStatus('live');
      clearSchedule();
      if (inFlight) {
        inFlight.abort();
        inFlight = null;
      }
      return analyze('requested');
    },
    /**
     * Runs a user request (question, read, find) with priority: any automatic analysis is cancelled
     * and nothing automatic runs until the request finishes.
     */
    async runExclusive<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      clearSchedule();
      inFlight?.abort();
      inFlight = null;
      exclusive = true;
      const controller = new AbortController();
      inFlight = controller;
      try {
        frames++;
        return await task(controller.signal);
      } finally {
        if (inFlight === controller) inFlight = null;
        exclusive = false;
        if (active()) schedule();
      }
    },
    /** Remembers a frame analyzed outside the loop (e.g. for a question) so follow-ups can refer to it. */
    record(image: CapturedImage, text: string) {
      const observation: Observation = { id: nextId++, text, capturedAt: image.capturedAt, image, source: 'requested' };
      remember(observation);
      return observation;
    },
    /** Cancels whatever is running, including a user request. */
    cancelCurrent() {
      inFlight?.abort();
      inFlight = null;
    },
  };
}

export type LiveExploreController = ReturnType<typeof createLiveExploreController>;
