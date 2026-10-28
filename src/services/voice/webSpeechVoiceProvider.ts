import type { ListeningHandlers, ListeningSession, SpeechErrorKind, VoiceProvider } from '../../types/voice';

function getRecognitionConstructor(): BrowserSpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function mapRecognitionError(error: string): SpeechErrorKind {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'no-speech':
      return 'no-speech';
    case 'audio-capture':
      return 'audio-capture';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export const SPEECH_WATCHDOG = {
  pollMs: 250,
  /** Consecutive polls with the speaker idle before speech counts as finished. */
  quietPolls: 3,
  /** Time allowed for audio to start before an idle speaker counts as finished. */
  startGraceMs: 2500,
  slackMs: 5000,
} as const;

/** Rough spoken duration at about 15 characters per second at normal rate. */
export function estimateSpeechMs(text: string, rate: number) {
  return (text.length / 15 / Math.max(rate, 0.5)) * 1000;
}

/**
 * Uses the browser's built-in Web Speech API.
 * Note: some browsers (e.g. Chrome) perform recognition on their own online service.
 */
export function createWebSpeechVoiceProvider(): VoiceProvider {
  const synth = (): SpeechSynthesis | undefined =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  let current: SpeechSynthesisUtterance | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const clearWatchdog = () => {
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
  };

  return {
    id: 'browser-web-speech',
    isRecognitionSupported: () => Boolean(getRecognitionConstructor()),
    isSynthesisSupported: () => Boolean(synth()) && typeof SpeechSynthesisUtterance !== 'undefined',

    async requestMicrophone() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw 'unsupported' as SpeechErrorKind;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        throw (name === 'NotAllowedError' || name === 'SecurityError' ? 'permission-denied' : 'audio-capture') as SpeechErrorKind;
      }
      stream.getTracks().forEach((track) => track.stop());
    },

    startListening(handlers: ListeningHandlers, lang = navigator.language || 'en-US'): ListeningSession {
      const Ctor = getRecognitionConstructor();
      if (!Ctor) {
        handlers.onError('unsupported');
        handlers.onEnd();
        return { stop() {}, abort() {} };
      }
      const recognition = new Ctor();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) final += result[0].transcript;
          else interim += result[0].transcript;
        }
        if (interim) handlers.onInterim?.(interim.trim());
        if (final.trim()) handlers.onFinal(final.trim());
      };
      recognition.onerror = (event) => handlers.onError(mapRecognitionError(event.error));
      recognition.onend = () => handlers.onEnd();

      try {
        recognition.start();
      } catch {
        handlers.onError('unknown');
        handlers.onEnd();
      }
      return {
        stop: () => recognition.stop(),
        abort: () => recognition.abort(),
      };
    },

    speak(text, { rate, lang, voiceURI, onStart, onEnd }) {
      const s = synth();
      if (!s) return;
      clearWatchdog();
      s.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      // Chrome drops end events for utterances that are no longer referenced.
      current = utterance;
      utterance.rate = rate;
      const chosen = voiceURI ? s.getVoices().find((v) => v.voiceURI === voiceURI) : undefined;
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang;
      } else if (lang) utterance.lang = lang;

      let started = false;
      let done = false;
      const startedAt = Date.now();
      const deadline = startedAt + estimateSpeechMs(text, rate) * 2 + SPEECH_WATCHDOG.slackMs;
      let quietPolls = 0;
      let timer: ReturnType<typeof setInterval> | null = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (watchdog === timer) clearWatchdog();
        if (current === utterance) current = null;
        onEnd?.();
      };
      const begin = () => {
        if (started || done) return;
        started = true;
        onStart?.();
      };
      utterance.onstart = begin;
      utterance.onend = finish;
      utterance.onerror = finish;
      s.speak(utterance);

      // Android Chrome sometimes never fires onend; confirm completion from the speaker state instead.
      if (done) return;
      timer = setInterval(() => {
        if (done) return;
        if (s.paused) return;
        const busy = s.speaking || s.pending;
        if (busy && !started && Date.now() - startedAt > SPEECH_WATCHDOG.startGraceMs) begin();
        const graceOver = started || Date.now() - startedAt > SPEECH_WATCHDOG.startGraceMs;
        quietPolls = busy ? 0 : quietPolls + 1;
        if ((graceOver && quietPolls >= SPEECH_WATCHDOG.quietPolls) || Date.now() > deadline) {
          s.cancel();
          finish();
        }
      }, SPEECH_WATCHDOG.pollMs);
      watchdog = timer;
    },
    getVoices: () =>
      (synth()?.getVoices() ?? []).map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang })),
    pause: () => synth()?.pause(),
    resume: () => synth()?.resume(),
    stopSpeaking: () => {
      clearWatchdog();
      current = null;
      synth()?.cancel();
    },
  };
}
