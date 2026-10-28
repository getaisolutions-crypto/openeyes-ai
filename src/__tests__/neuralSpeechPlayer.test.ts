import { describe, expect, it, vi } from 'vitest';
import { createNeuralSpeechPlayer } from '../services/voice/neuralSpeechPlayer';
import { NeuralTTSError, type NeuralTTSProvider } from '../types/tts';

function fakeAudio() {
  const audio = {
    src: '',
    onplaying: null as null | (() => void),
    onended: null as null | (() => void),
    onerror: null as null | (() => void),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
  };
  return audio;
}

function provider(synth: NeuralTTSProvider['synthesize']): NeuralTTSProvider {
  return {
    id: 'test',
    label: 'Test voice',
    isConfigured: () => true,
    supportsStreaming: false,
    listVoices: async () => [],
    synthesize: synth,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('natural voice player', () => {
  it('plays synthesized audio and reports start and end', async () => {
    const audio = fakeAudio();
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const player = createNeuralSpeechPlayer(provider(async () => new Blob(['x'])), () => audio as unknown as HTMLAudioElement);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    player.speak('Hello', { rate: 1 }, { onStart, onEnd, onError: vi.fn() });
    await flush();
    expect(audio.play).toHaveBeenCalled();
    audio.onplaying?.();
    audio.onended?.();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('reports errors so the app can fall back to the browser voice', async () => {
    const onError = vi.fn();
    const player = createNeuralSpeechPlayer(
      provider(async () => {
        throw new NeuralTTSError('not-configured', 'No voice service');
      }),
    );
    player.speak('Hello', { rate: 1 }, { onEnd: vi.fn(), onError });
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ kind: 'not-configured' }));
  });

  it('stop cancels synthesis and never plays the old audio', async () => {
    let signal: AbortSignal | null = null;
    let resolve: (b: Blob) => void = () => undefined;
    const audio = fakeAudio();
    const player = createNeuralSpeechPlayer(
      provider((_t, _c, s) => {
        signal = s;
        return new Promise<Blob>((r) => (resolve = r));
      }),
      () => audio as unknown as HTMLAudioElement,
    );
    const onEnd = vi.fn();
    player.speak('Old', { rate: 1 }, { onEnd, onError: vi.fn() });
    player.stop();
    expect(signal!.aborted).toBe(true);
    resolve(new Blob(['x']));
    await flush();
    expect(audio.play).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
