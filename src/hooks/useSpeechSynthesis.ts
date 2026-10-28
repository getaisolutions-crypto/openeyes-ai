import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useSettings } from './useSettings';

export type SpeakingState = 'idle' | 'speaking' | 'paused';

export function useSpeechSynthesis() {
  const { voice } = useServices();
  const { settings } = useSettings();
  const supported = voice.isSynthesisSupported();
  const [state, setState] = useState<SpeakingState>('idle');
  // Cancelling one utterance fires its end event late; only the latest utterance may reset the state.
  const utteranceId = useRef(0);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (!supported || !text.trim()) {
        onDone?.();
        return;
      }
      const id = ++utteranceId.current;
      voice.speak(text, {
        rate: settings.speechRate,
        voiceURI: settings.voiceURI || undefined,
        onEnd: () => {
          if (id !== utteranceId.current) return;
          setState('idle');
          onDone?.();
        },
      });
      setState('speaking');
    },
    [supported, voice, settings.speechRate, settings.voiceURI],
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
    utteranceId.current++;
    voice.stopSpeaking();
    setState('idle');
  }, [voice]);

  useEffect(() => () => voice.stopSpeaking(), [voice]);

  return { supported, state, speak, pause, resume, stop };
}
