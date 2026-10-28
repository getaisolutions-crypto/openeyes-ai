import { createBrowserSpeechPlayback } from './browserSpeechPlayback';
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

/**
 * Uses the browser's built-in Web Speech API.
 * Note: some browsers (e.g. Chrome) perform recognition on their own online service.
 */
export function createWebSpeechVoiceProvider(): VoiceProvider {
  const synth = (): SpeechSynthesis | undefined =>
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  const playback = createBrowserSpeechPlayback(synth);

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
      const voice = voiceURI ? s.getVoices().find((v) => v.voiceURI === voiceURI) : undefined;
      playback.speak(text, { rate, lang, voice, onStart, onEnd });
    },
    getVoices: () =>
      (synth()?.getVoices() ?? []).map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang })),
    pause: () => playback.pause(),
    resume: () => playback.resume(),
    stopSpeaking: () => playback.stop(),
  };
}
