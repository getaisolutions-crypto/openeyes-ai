export type SpeechErrorKind =
  | 'unsupported'
  | 'permission-denied'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  /** The Meta voice service could not be reached, refused the session or failed mid-turn. */
  | 'service-unavailable'
  | 'unknown';

export interface ListeningHandlers {
  onInterim?: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (kind: SpeechErrorKind) => void;
  onEnd: () => void;
}

/** Anything that can listen for one turn of speech: the browser's recognizer or Meta Muse Voice Transcribe. */
export interface SpeechRecognizer {
  readonly id: 'meta-voice' | 'browser';
  isSupported(): boolean;
  startListening(handlers: ListeningHandlers): ListeningSession;
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
  /** Called when audio actually starts, used to measure playback delay. */
  onStart?: () => void;
  onEnd?: () => void;
}

export interface VoiceOption {
  voiceURI: string;
  name: string;
  lang: string;
}

/** Browser speech input and output (Web Speech API). Meta Muse Voice Transcribe is a separate SpeechRecognizer. */
export interface VoiceProvider {
  readonly id: string;
  isRecognitionSupported(): boolean;
  isSynthesisSupported(): boolean;
  /**
   * Asks for microphone permission with echo cancellation and releases the microphone straight away.
   * Rejects with a SpeechErrorKind.
   */
  requestMicrophone(): Promise<void>;
  startListening(handlers: ListeningHandlers, lang?: string): ListeningSession;
  speak(text: string, options: SpeakOptions): void;
  /** Voices installed on the device. May be empty until the browser has loaded them. */
  getVoices(): VoiceOption[];
  pause(): void;
  resume(): void;
  stopSpeaking(): void;
}
