import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEECH_WATCHDOG, createWebSpeechVoiceProvider } from '../services/voice/webSpeechVoiceProvider';

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

function installSynth() {
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    last: null as FakeUtterance | null,
    speak: vi.fn((u: FakeUtterance) => {
      synth.last = u;
      synth.speaking = true;
    }),
    cancel: vi.fn(() => {
      synth.speaking = false;
    }),
    getVoices: () => [],
    pause: vi.fn(),
    resume: vi.fn(),
  };
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  return synth;
}

describe('browser speech completion on Android', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports the end when the speaker goes quiet but onend never fires', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onStart = vi.fn();
    createWebSpeechVoiceProvider().speak('There is a laptop and a bottle.', { rate: 1, onStart, onEnd });
    synth.last?.onstart?.();
    vi.advanceTimersByTime(2000);
    expect(onEnd).not.toHaveBeenCalled();
    synth.speaking = false;
    vi.advanceTimersByTime(SPEECH_WATCHDOG.pollMs * (SPEECH_WATCHDOG.quietPolls + 1));
    expect(onEnd).toHaveBeenCalledTimes(1);
    synth.last?.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('reports the end when onstart is also lost', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const onStart = vi.fn();
    createWebSpeechVoiceProvider().speak('Hello.', { rate: 1, onStart, onEnd });
    vi.advanceTimersByTime(SPEECH_WATCHDOG.startGraceMs + 500);
    expect(onStart).toHaveBeenCalledTimes(1);
    synth.speaking = false;
    vi.advanceTimersByTime(SPEECH_WATCHDOG.pollMs * (SPEECH_WATCHDOG.quietPolls + 1));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not end early while paused, and fires once on a normal end', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    createWebSpeechVoiceProvider().speak('Hello there.', { rate: 1, onEnd });
    synth.last?.onstart?.();
    synth.paused = true;
    synth.speaking = false;
    vi.advanceTimersByTime(4000);
    expect(onEnd).not.toHaveBeenCalled();
    synth.paused = false;
    synth.last?.onend?.();
    vi.advanceTimersByTime(4000);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stopping speech cancels the watchdog', () => {
    const synth = installSynth();
    const onEnd = vi.fn();
    const provider = createWebSpeechVoiceProvider();
    provider.speak('Hello.', { rate: 1, onEnd });
    provider.stopSpeaking();
    synth.speaking = false;
    vi.advanceTimersByTime(60_000);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
