import type { ResponseLength } from './ai';
import type { CameraSourceId } from './camera';

export type Theme = 'dark' | 'light';
export type TextSize = 'normal' | 'large' | 'xlarge' | 'xxlarge';
export type AssistanceMode = 'reactive' | 'reactive-proactive';
export type ProactiveFrequency = 'low' | 'medium' | 'high';
/** ask: analyze only on request. smart: announce meaningful changes. continuous: describe every new frame. */
export type ExploreMode = 'ask' | 'smart' | 'continuous';
export type ExploreInterval = 8 | 12 | 20 | 30;
export type ExploreSessionMinutes = 5 | 10 | 15;
/** meta: Meta Muse Voice Transcribe with automatic fallback to the browser. browser: the browser's own recognition. */
export type SpeechRecognitionChoice = 'meta' | 'browser';

export interface Settings {
  theme: Theme;
  highContrast: boolean;
  textSize: TextSize;
  reduceMotion: boolean;
  voiceOutput: boolean;
  speechRate: number;
  responseLength: ResponseLength;
  rememberConversation: boolean;
  cameraSource: CameraSourceId;
  assistanceMode: AssistanceMode;
  proactiveFrequency: ProactiveFrequency;
  quietMode: boolean;
  /** Empty string means the device's default voice. */
  voiceURI: string;
  exploreMode: ExploreMode;
  exploreIntervalSeconds: ExploreInterval;
  exploreSessionMinutes: ExploreSessionMinutes;
  /** Voice conversation listens again by itself after each reply. Off means tap Talk for every turn. */
  conversationHandsFree: boolean;
  speechRecognition: SpeechRecognitionChoice;
  /** Experimental: only respond to speech that starts with "Hey OpenEyes". */
  conversationWakePhrase: boolean;
  /** Experimental: listen while OpenEyes is speaking so you can interrupt by voice. */
  conversationBargeIn: boolean;
  /** Shows timing figures for each voice turn. No words or audio are shown or stored. */
  voiceDiagnostics: boolean;
}
