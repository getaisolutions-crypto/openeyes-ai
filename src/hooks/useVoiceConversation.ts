import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../services/ServicesContext';
import { useSettings } from './useSettings';
import { useAnnouncer } from './useAnnouncer';
import { SPEECH_ERROR_MESSAGES } from './useSpeechRecognition';
import type { useSpeechSynthesis } from './useSpeechSynthesis';
import type { SayKind, SpeechRouter } from './useLiveExplore';
import {
  createVoiceConversationEngine,
  type ConversationEndReason,
  type TurnMetrics,
  type VoiceConversationEngine,
} from '../services/voice/voiceConversationEngine';
import type { ConversationState } from '../services/voice/conversationStateMachine';
import type { Settings } from '../types/settings';

export const VOICE_SESSION_MAX_MINUTES = 15;

const END_PHRASE = /^(stop|end|finish|close)( the| this)? (voice )?(conversation|chat|talking|listening)$|^(goodbye|bye|that'?s all|stop talking)$/;

const END_MESSAGES: Record<Exclude<ConversationEndReason, 'unmount'>, string> = {
  user: 'Voice conversation ended. Microphone off.',
  command: 'Voice conversation ended. Microphone off.',
  'session-limit': `Voice conversation ended after ${VOICE_SESSION_MAX_MINUTES} minutes. Microphone off. You can start again.`,
  hidden: 'Voice conversation ended because OpenEyes left the screen. Microphone off.',
  'permission-denied':
    'Microphone permission was denied, so the voice conversation cannot start. You can still type your question, or allow the microphone for this site in your browser settings.',
  'microphone-unavailable': 'The microphone could not start. Check that no other app is using it, then try again. You can still type your question.',
  unsupported: 'This browser cannot recognize speech. Try Chrome on Android, or type your question.',
};

function engineConfig(s: Settings) {
  return {
    handsFree: s.conversationHandsFree,
    wakePhrase: s.conversationWakePhrase,
    bargeIn: s.conversationBargeIn,
    maxDurationMs: VOICE_SESSION_MAX_MINUTES * 60_000,
  };
}

/** Rough reading time for the screen reader when spoken replies are off, so listening does not start over it. */
function readingTimeMs(text: string, rate: number) {
  return Math.min(15_000, 1200 + (text.length * 60) / Math.max(rate, 0.5));
}

export interface VoiceConversationOptions {
  speech: ReturnType<typeof useSpeechSynthesis>;
  /** Handles one request and resolves after the answer has been given. */
  handleTurn(text: string, signal: AbortSignal): Promise<void>;
  cancelPending(): void;
  setSpeechRouter(router: SpeechRouter | null): void;
  /** Speaks or announces outside the conversation, used for the closing message. */
  say(text: string, kind: SayKind): void;
  addNotice(text: string): void;
  addHeard(text: string): void;
  onEnded(): void;
  isExploring(): boolean;
}

export function useVoiceConversation(options: VoiceConversationOptions) {
  const { voice } = useServices();
  const { settings } = useSettings();
  const { announce } = useAnnouncer();
  const [state, setState] = useState<ConversationState>('idle');
  const [bargeInListening, setBargeInListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [metrics, setMetrics] = useState<TurnMetrics | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const engineRef = useRef<VoiceConversationEngine | null>(null);

  const getEngine = useCallback((): VoiceConversationEngine => {
    if (engineRef.current) return engineRef.current;
    const engine = createVoiceConversationEngine(
      {
        recognizer: {
          isSupported: () => voice.isRecognitionSupported(),
          requestMicrophone: () => voice.requestMicrophone(),
          startListening: (handlers) => voice.startListening(handlers),
        },
        output: {
          speak: (text, { onStart, onEnd }) => {
            const s = settingsRef.current;
            const o = optionsRef.current;
            if (o.speech.supported && s.voiceOutput && !s.quietMode) {
              o.speech.speak(text, onEnd, onStart);
            } else {
              announce(text);
              onStart();
              setTimeout(onEnd, readingTimeMs(text, s.speechRate));
            }
          },
          stop: () => optionsRef.current.speech.stop(),
        },
        handleTurn: async (text, { signal }) => {
          const o = optionsRef.current;
          const normalized = text.toLowerCase().replace(/[.!?,]/g, '').trim();
          if (END_PHRASE.test(normalized) || (normalized === 'stop' && !o.isExploring())) {
            o.addHeard(text);
            engine.stop('command');
            return;
          }
          await o.handleTurn(text, signal);
        },
        cancelPending: () => optionsRef.current.cancelPending(),
        onState: (next, info) => {
          setState(next);
          setBargeInListening(info.bargeInListening);
          if (next !== 'user-speaking') setInterim('');
        },
        onInterim: setInterim,
        onNotice: (kind, error) => {
          const message =
            kind === 'stopped-listening'
              ? 'I stopped listening because I did not hear anything. Tap Talk when you want to speak.'
              : `${error && error !== 'no-speech' ? `${SPEECH_ERROR_MESSAGES[error]} ` : ''}Hands-free listening is not working well here, so tap Talk each time you want to speak.`;
          optionsRef.current.addNotice(message);
          return message;
        },
        onMetrics: setMetrics,
        onEnd: (reason) => {
          const o = optionsRef.current;
          o.setSpeechRouter(null);
          o.onEnded();
          setInterim('');
          setBargeInListening(false);
          if (reason === 'unmount') return;
          const message = END_MESSAGES[reason];
          o.addNotice(message);
          o.say(message, 'status');
        },
      },
      engineConfig(settingsRef.current),
    );
    engineRef.current = engine;
    return engine;
  }, [announce, voice]);

  useEffect(() => {
    engineRef.current?.setConfig(engineConfig(settings));
  }, [settings]);

  const active = state !== 'idle' && state !== 'stopped' && state !== 'error';

  useEffect(() => {
    if (!active) return;
    const onHidden = () => {
      if (document.hidden) engineRef.current?.stop('hidden');
    };
    const onPageHide = () => engineRef.current?.stop('hidden');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [active]);

  useEffect(() => () => engineRef.current?.stop('unmount'), []);

  const start = useCallback(async () => {
    const engine = getEngine();
    if (engine.active) return;
    setMetrics(null);
    const s = settingsRef.current;
    engine.setConfig(engineConfig(s));
    optionsRef.current.setSpeechRouter({
      say: (text, kind) => engine.say(text, kind),
      hush: () => engine.hush(),
    });
    const parts = ['Voice conversation started. Microphone on.'];
    parts.push(s.conversationWakePhrase ? 'Start each request with Hey OpenEyes.' : 'Ask me anything.');
    if (!optionsRef.current.isExploring()) parts.push('The camera is off. Say start exploring if you want me to look.');
    parts.push('Say stop conversation to end.');
    const started = await engine.start(parts.join(' '));
    if (started) optionsRef.current.addNotice('Voice conversation started. Microphone on.');
  }, [getEngine]);

  const stop = useCallback(() => engineRef.current?.stop('user'), []);
  const interrupt = useCallback(() => engineRef.current?.interrupt(), []);
  const submit = useCallback((text: string) => engineRef.current?.submit(text), []);

  return {
    supported: voice.isRecognitionSupported(),
    state,
    active,
    interim,
    metrics,
    bargeInListening,
    start,
    stop,
    interrupt,
    submit,
  };
}

export type VoiceConversation = ReturnType<typeof useVoiceConversation>;
