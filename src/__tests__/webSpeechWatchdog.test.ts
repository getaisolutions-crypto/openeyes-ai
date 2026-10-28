import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_WATCHDOG, createBrowserSpeechPlayback, splitForSpeech } from '../services/voice/browserSpeechPlayback';

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

/** Mimics Android Chrome: the test decides whether start/end events arrive at all. */
function createSynth() {
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    spoken: [] as FakeUtterance[],
    speak: vi.fn((u: FakeUtterance) => {
      synth.spoken.push(u);
      synth.speaking = true;
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
    }),
    pause: vi.fn(() => {
      synth.paused = true;
    }),
    resume: vi.fn(() => {
      synth.paused = false;
    }),
    getVoices: () => [],
    get last() {
      return synth.spoken[synth.spoken.length - 1];
    },
  };
  return synth;
}

const quietWait = SPEECH_WATCHDOG.pollMs * (SPEECH_WATCHDOG.quietPolls + 1);

function setup() {
  const synth = createSynth();
  const playback = createBrowserSpeechPlayback(() => synth as unknown as SpeechSynthesis);
  const onStart = vi.fn();
  const onEnd = vi.fn();
  return { synth, playback, onStart, onEnd, speak: (text: string) => playback.speak(text, { rate: 1, onStart, onEnd }) };
}

describe('browser speech completion (Android-style lifecycle)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports the end once when the speaker goes quiet but onend never fires', () => {
    const t = setup();
    t.speak('There is a laptop and a bottle.');
    t.synth.last.onstart?.();
    vi.advanceTimersByTime(2000);
    expect(t.onEnd).not.toHaveBeenCalled();
    t.synth.speaking = false;
    vi.advanceTimersByTime(quietWait);
    expect(t.onEnd).toHaveBeenCalledTimes(1);
    t.synth.last.onend?.();
    vi.advanceTimersByTime(10_000);
    expect(t.onEnd).toHaveBeenCalledTimes(1);
  });

  it('detects the start from the speaker state when onstart is lost', () => {
    const t = setup();
    t.speak('Hello.');
    vi.advanceTimersByTime(SPEECH_WATCHDOG.pollMs * 2);
    expect(t.onStart).toHaveBeenCalledTimes(1);
    t.synth.speaking = false;
    vi.advanceTimersByTime(quietWait);
    expect(t.onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not treat a silent engine that never started as finished: it retries once first', () => {
    const t = setup();
    t.synth.speak.mockImplementation((u: FakeUtterance) => {
      t.synth.spoken.push(u);
    });
    t.speak('Hello.');
    vi.advanceTimersByTime(SPEECH_WATCHDOG.startGraceMs + 500);
    expect(t.synth.speak).toHaveBeenCalledTimes(2);
    expect(t.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SPEECH_WATCHDOG.startGraceMs + 500);
    expect(t.onEnd).toHaveBeenCalledTimes(1);
  });

  it('speaks a long description piece by piece without cutting it off', () => {
    const t = setup();
    const sentence = 'On the table there is a laptop, a blue bottle and a notebook next to a small lamp. ';
    t.speak(sentence.repeat(8));
    const pieces = splitForSpeech(sentence.repeat(8)).length;
    expect(pieces).toBeGreaterThan(2);
    for (let i = 0; i < pieces; i++) {
      t.synth.last.onstart?.();
      // Each piece plays for a realistic 12 seconds while the engine reports speaking.
      vi.advanceTimersByTime(12_000);
      expect(t.onEnd).not.toHaveBeenCalled();
      t.synth.last.onend?.();
    }
    expect(t.synth.spoken).toHaveLength(pieces);
    expect(t.onEnd).toHaveBeenCalledTimes(1);
  });

  it('never treats paused speech as finished, and continues after resume', () => {
    const t = setup();
    t.speak('First sentence here. Second sentence follows.'.repeat(5));
    t.synth.last.onstart?.();
    t.playback.pause();
    t.synth.speaking = false;
    vi.advanceTimersByTime(120_000);
    expect(t.onEnd).not.toHaveBeenCalled();
    t.synth.speaking = true;
    t.playback.resume();
    vi.advanceTimersByTime(1000);
    expect(t.onEnd).not.toHaveBeenCalled();
  });

  it('replays the interrupted piece when Android dropped speech during pause', () => {
    const t = setup();
    t.speak('Hello there.');
    t.synth.last.onstart?.();
    t.playback.pause();
    t.synth.speaking = false;
    t.playback.resume();
    expect(t.synth.speak).toHaveBeenCalledTimes(2);
  });

  it('stopping cancels monitoring and never reports an end', () => {
    const t = setup();
    t.speak('Hello.');
    t.playback.stop();
    t.synth.last.onend?.();
    vi.advanceTimersByTime(60_000);
    expect(t.onEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a newer utterance replaces the old one; stale events are ignored', () => {
    const t = setup();
    t.speak('Old answer.');
    const old = t.synth.last;
    const onEnd2 = vi.fn();
    t.playback.speak('New answer.', { rate: 1, onEnd: onEnd2 });
    old.onend?.();
    expect(t.onEnd).not.toHaveBeenCalled();
    expect(onEnd2).not.toHaveBeenCalled();
    t.synth.last.onend?.();
    expect(onEnd2).toHaveBeenCalledTimes(1);
  });

  it('splits text into pieces no longer than the limit', () => {
    const text = 'word '.repeat(200);
    const pieces = splitForSpeech(text);
    expect(pieces.every((p) => p.length <= SPEECH_WATCHDOG.maxChunkChars)).toBe(true);
    expect(pieces.join(' ').split(' ').length).toBe(200);
    expect(splitForSpeech('   ')).toEqual([]);
  });
});
