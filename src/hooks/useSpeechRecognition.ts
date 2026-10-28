import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListeningSession, SpeechErrorKind } from '../types/voice';
import { useServices } from '../services/ServicesContext';

export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  unsupported: 'Voice input is not supported in this browser. Please type instead. Chrome on Android supports voice input.',
  'permission-denied': 'Microphone access was blocked. Allow the microphone in your browser or phone settings, or type instead.',
  'no-speech': 'I did not hear anything. Please try again.',
  'audio-capture': 'No microphone was found or it could not be used.',
  network: 'Voice input needs an internet connection in this browser. Please check your connection or type instead.',
  aborted: 'Listening was stopped.',
  'service-unavailable': 'The Meta voice service is not available right now.',
  unknown: 'Voice input stopped unexpectedly. Please try again or type instead.',
};

interface Options {
  onFinal: (transcript: string) => void;
}

export function useSpeechRecognition({ onFinal }: Options) {
  const { voice } = useServices();
  const supported = voice.isRecognitionSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechErrorKind | null>(null);
  const session = useRef<ListeningSession | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const start = useCallback(() => {
    setError(null);
    setInterim('');
    if (!supported) {
      setError('unsupported');
      return;
    }
    voice.stopSpeaking();
    setListening(true);
    session.current = voice.startListening({
      onInterim: setInterim,
      onFinal: (text) => {
        setInterim('');
        onFinalRef.current(text);
      },
      onError: (kind) => {
        if (kind !== 'aborted') setError(kind);
      },
      onEnd: () => {
        setListening(false);
        setInterim('');
        session.current = null;
      },
    });
  }, [supported, voice]);

  const stop = useCallback(() => session.current?.stop(), []);

  useEffect(() => () => session.current?.abort(), []);

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) };
}
