import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { createNeuralSpeechPlayer } from '../services/voice/neuralSpeechPlayer';
import { useSettings } from './useSettings';

export type SpeakingState = 'idle' | 'speaking' | 'paused';

/**
 * Speech output. Uses the configured natural voice when one exists and falls back to the browser's own
 * voices for that utterance if it fails; otherwise always uses the browser voices.
 */
export function useSpeechSynthesis() {
  const { voice, neuralTTS } = useServices();
  const { settings } = useSettings();
  const neural = useMemo(() => (neuralTTS?.isConfigured() ? createNeuralSpeechPlayer(neuralTTS) : null), [neuralTTS]);
  const supported = voice.isSynthesisSupported() || Boolean(neural);
  const [state, setState] = useState<SpeakingState>('idle');
  // Cancelling one utterance fires its end event late; only the latest utterance may reset the state.
  const utteranceId = useRef(0);

  const speak = useCallback(
    (text: string, onDone?: () => void, onStart?: () => void) => {
      if (!supported || !text.trim()) {
        onDone?.();
        return;
      }
      const id = ++utteranceId.current;
      const finish = () => {
        if (id !== utteranceId.current) return;
        setState('idle');
        onDone?.();
      };
      const speakWithBrowser = () => {
        if (!voice.isSynthesisSupported()) {
          finish();
          return;
        }
        voice.speak(text, {
          rate: settings.speechRate,
          voiceURI: settings.voiceURI || undefined,
          onStart: () => {
            if (id === utteranceId.current) onStart?.();
          },
          onEnd: finish,
        });
      };
      setState('speaking');
      if (neural) {
        neural.speak(text, { rate: settings.speechRate }, {
          onStart: () => {
            if (id === utteranceId.current) onStart?.();
          },
          onEnd: finish,
          onError: () => {
            if (id === utteranceId.current) speakWithBrowser();
          },
        });
      } else {
        speakWithBrowser();
      }
    },
    [neural, supported, voice, settings.speechRate, settings.voiceURI],
  );

  const pause = useCallback(() => {
    neural?.pause();
    voice.pause();
    setState('paused');
  }, [neural, voice]);

  const resume = useCallback(() => {
    neural?.resume();
    voice.resume();
    setState('speaking');
  }, [neural, voice]);

  const stop = useCallback(() => {
    utteranceId.current++;
    neural?.stop();
    voice.stopSpeaking();
    setState('idle');
  }, [neural, voice]);

  useEffect(
    () => () => {
      neural?.stop();
      voice.stopSpeaking();
    },
    [neural, voice],
  );

  return { supported, state, speak, pause, resume, stop, usingNaturalVoice: Boolean(neural) };
}
