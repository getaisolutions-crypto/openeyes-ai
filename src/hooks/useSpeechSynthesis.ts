import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useSettings } from './useSettings';

export type SpeakingState = 'idle' | 'speaking' | 'paused';

export function useSpeechSynthesis() {
  const { voice } = useServices();
  const { settings } = useSettings();
  const supported = voice.isSynthesisSupported();
  const [state, setState] = useState<SpeakingState>('idle');

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      voice.speak(text, { rate: settings.speechRate, onEnd: () => setState('idle') });
      setState('speaking');
    },
    [supported, voice, settings.speechRate],
  );

  const pause = useCallback(() => {
    voice.pause();
    setState('paused');
  }, [voice]);

  const resume = useCallback(() => {
    voice.resume();
    setState('speaking');
  }, [voice]);

  const stop = useCallback(() => {
    voice.stopSpeaking();
    setState('idle');
  }, [voice]);

  useEffect(() => () => voice.stopSpeaking(), [voice]);

  return { supported, state, speak, pause, resume, stop };
}
