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
}
