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

  return {
    id: 'browser-web-speech',
    isRecognitionSupported: () => Boolean(getRecognitionConstructor()),
    isSynthesisSupported: () => Boolean(synth()) && typeof SpeechSynthesisUtterance !== 'undefined',

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

    speak(text, { rate, lang, onEnd }) {
      const s = synth();
      if (!s) return;
      s.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      if (lang) utterance.lang = lang;
      utterance.onend = () => onEnd?.();
      utterance.onerror = () => onEnd?.();
      s.speak(utterance);
    },
    pause: () => synth()?.pause(),
    resume: () => synth()?.resume(),
    stopSpeaking: () => synth()?.cancel(),
  };
}
