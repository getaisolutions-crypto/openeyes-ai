import { NeuralTTSError, type NeuralSpeechConfig, type NeuralTTSProvider } from '../../types/tts';

export interface PlaybackCallbacks {
  onStart?: () => void;
  onEnd: () => void;
  /** Called instead of onEnd when audio could not be produced or played, so the caller can fall back. */
  onError: (error: NeuralTTSError) => void;
}

interface Job {
  abort: AbortController;
  audio?: HTMLAudioElement;
  url?: string;
}

/** Plays audio from a neural TTS provider, one utterance at a time. A new utterance cancels the old one. */
export function createNeuralSpeechPlayer(provider: NeuralTTSProvider, createAudio: () => HTMLAudioElement = () => new Audio()) {
  let current: Job | null = null;

  function release(job: Job) {
    if (job.audio) {
      job.audio.onplaying = null;
      job.audio.onended = null;
      job.audio.onerror = null;
      job.audio.pause();
      job.audio.removeAttribute('src');
    }
    if (job.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(job.url);
  }

  function stop() {
    const job = current;
    current = null;
    if (!job) return;
    job.abort.abort();
    release(job);
  }

  return {
    speak(text: string, config: NeuralSpeechConfig, callbacks: PlaybackCallbacks) {
      stop();
      const job: Job = { abort: new AbortController() };
      current = job;
      const fail = (error: unknown) => {
        if (current !== job) return;
        current = null;
        release(job);
        callbacks.onError(error instanceof NeuralTTSError ? error : new NeuralTTSError('playback', 'The natural voice could not play.'));
      };
      provider
        .synthesize(text, config, job.abort.signal)
        .then((blob) => {
          if (current !== job) return;
          job.url = URL.createObjectURL(blob);
          const audio = createAudio();
          job.audio = audio;
          let started = false;
          audio.onplaying = () => {
            if (started || current !== job) return;
            started = true;
            callbacks.onStart?.();
          };
          audio.onended = () => {
            if (current !== job) return;
            current = null;
            release(job);
            callbacks.onEnd();
          };
          audio.onerror = () => fail(new NeuralTTSError('playback', 'The natural voice could not play.'));
          audio.src = job.url;
          return audio.play();
        })
        .catch(fail);
    },
    stop,
    pause: () => current?.audio?.pause(),
    resume: () => {
      const audio = current?.audio;
      if (audio) void Promise.resolve(audio.play()).catch(() => undefined);
    },
  };
}

export type NeuralSpeechPlayer = ReturnType<typeof createNeuralSpeechPlayer>;
