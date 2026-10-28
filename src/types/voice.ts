export type SpeechErrorKind =
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface ListeningHandlers {
  onInterim?: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (kind: SpeechErrorKind) => void;
  onEnd: () => void;
}

export interface ListeningSession {
  stop(): void;
  abort(): void;
}

export interface SpeakOptions {
  rate: number;
  lang?: string;
  /** Browser voice identifier chosen in Settings. Falls back to the default voice when missing. */
  voiceURI?: string;
  onEnd?: () => void;
}

export interface VoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
}

/** Speech input and output. Browser implementation today; Muse Voice Transcribe planned for Phase 2. */
export interface VoiceProvider {
  readonly id: string;
  isRecognitionSupported(): boolean;
  isSynthesisSupported(): boolean;
  startListening(handlers: ListeningHandlers, lang?: string): ListeningSession;
  speak(text: string, options: SpeakOptions): void;
  /** Voices installed on the device. May be empty until the browser has loaded them. */
  getVoices(): VoiceOption[];
  pause(): void;
  resume(): void;
  stopSpeaking(): void;
}
