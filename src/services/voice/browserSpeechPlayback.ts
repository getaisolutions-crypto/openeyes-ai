export interface PlaybackOptions {
  rate: number;
  lang?: string;
  voice?: SpeechSynthesisVoice;
  onStart?: () => void;
  onEnd?: () => void;
}

export const SPEECH_WATCHDOG = {
  pollMs: 250,
  /** Consecutive idle polls after audio started before a piece counts as finished (its end event was lost). */
  quietPolls: 3,
  /** Time for audio to start before the piece is spoken again once, then skipped. */
  startGraceMs: 2500,
  /** A piece still "speaking" after three times its expected length plus this is treated as stuck. */
  stuckSlackMs: 8000,
  maxChunkChars: 180,
} as const;

/** Rough spoken duration at about 15 characters per second at normal rate. */
export function estimateSpeechMs(text: string, rate: number) {
  return (text.length / 15 / Math.max(rate, 0.5)) * 1000;
}

/** Splits text at sentence ends (then commas or spaces) so no single utterance runs long. */
export function splitForSpeech(text: string, max: number = SPEECH_WATCHDOG.maxChunkChars): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [];
  const chunks: string[] = [];
  let buffer = '';
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (trimmed) chunks.push(trimmed);
  };
  for (const sentence of sentences) {
    if ((buffer + sentence).length <= max) {
      buffer += sentence;
      continue;
    }
    push(buffer);
    buffer = '';
    let rest = sentence;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf(' '));
      const at = cut > max / 3 ? cut + 1 : max;
      push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    buffer = rest;
  }
  push(buffer);
  return chunks;
}

/**
 * Plays text through speechSynthesis and reports the end only once audio has really finished.
 * Android Chrome can lose onstart/onend, so each piece is also watched through speaking/pending/paused:
 * a piece that never starts is spoken again once, a piece that started and went quiet counts as finished,
 * and paused speech never counts as finished.
 */
export function createBrowserSpeechPlayback(getSynth: () => SpeechSynthesis | undefined, now: () => number = Date.now) {
  let session: { cancel(): void; pause(): void; resume(): void } | null = null;

  function speak(text: string, options: PlaybackOptions) {
    const s = getSynth();
    session?.cancel();
    session = null;
    if (!s) return;
    s.cancel();

    const chunks = splitForSpeech(text);
    let index = 0;
    let cancelled = false;
    let started = false;
    let paused = false;
    let current: SpeechSynthesisUtterance | null = null;
    let piece = { started: false, retried: false, startedAt: 0, pausedMs: 0, quiet: 0, ended: false };
    let pausedAt: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const finishAll = () => {
      if (cancelled) return;
      cancelled = true;
      stopTimer();
      current = null;
      if (session === controls) session = null;
      options.onEnd?.();
    };

    const markStarted = () => {
      piece.started = true;
      if (!started) {
        started = true;
        options.onStart?.();
      }
    };

    const next = () => {
      if (cancelled) return;
      index++;
      if (index >= chunks.length) finishAll();
      else if (!paused) play();
      else piece.ended = true;
    };

    const play = (retry = false) => {
      const u = new SpeechSynthesisUtterance(chunks[index]);
      // Keep a reference: Chrome drops events for utterances that are garbage collected.
      current = u;
      u.rate = options.rate;
      if (options.voice) {
        u.voice = options.voice;
        u.lang = options.voice.lang;
      } else if (options.lang) u.lang = options.lang;
      piece = { started: false, retried: retry, startedAt: now(), pausedMs: 0, quiet: 0, ended: false };
      u.onstart = () => {
        if (current === u && !cancelled) markStarted();
      };
      u.onend = () => {
        if (current === u && !cancelled) next();
      };
      u.onerror = () => {
        if (current === u && !cancelled) next();
      };
      s.speak(u);
    };

    const tick = () => {
      if (cancelled || !current) return;
      if (paused || s.paused) return;
      const busy = s.speaking || s.pending;
      const elapsed = now() - piece.startedAt - piece.pausedMs;
      if (!piece.started) {
        if (s.speaking) markStarted();
        else if (elapsed > SPEECH_WATCHDOG.startGraceMs) {
          // Audio never started: speak the piece once more, then move on so the conversation is not stuck.
          if (!piece.retried) {
            s.cancel();
            current = null;
            play(true);
          } else {
            s.cancel();
            next();
          }
        }
        return;
      }
      piece.quiet = busy ? 0 : piece.quiet + 1;
      const stuck = elapsed > estimateSpeechMs(chunks[index] ?? '', options.rate) * 3 + SPEECH_WATCHDOG.stuckSlackMs;
      if (piece.quiet >= SPEECH_WATCHDOG.quietPolls || stuck) {
        if (stuck) s.cancel();
        current = null;
        next();
      }
    };

    const controls = {
      cancel() {
        cancelled = true;
        stopTimer();
        current = null;
      },
      pause() {
        if (paused) return;
        paused = true;
        pausedAt = now();
        s.pause();
      },
      resume() {
        if (!paused) return;
        paused = false;
        if (pausedAt !== null) piece.pausedMs += now() - pausedAt;
        pausedAt = null;
        if (piece.ended) {
          play();
          return;
        }
        s.resume();
        // Some Android voices drop speech on pause; replay the interrupted piece if nothing is playing.
        if (!s.speaking && !s.pending && !s.paused && current) {
          s.cancel();
          play();
        }
      },
    };
    session = controls;

    if (chunks.length === 0) {
      finishAll();
      return;
    }
    play();
    if (!cancelled) timer = setInterval(tick, SPEECH_WATCHDOG.pollMs);
  }

  return {
    speak,
    pause: () => session?.pause(),
    resume: () => session?.resume(),
    stop() {
      session?.cancel();
      session = null;
      getSynth()?.cancel();
    },
  };
}
