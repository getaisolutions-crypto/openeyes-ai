import type { ResponseLength } from './ai';
import type { CameraSourceId } from './camera';

export type Theme = 'dark' | 'light';
export type TextSize = 'normal' | 'large' | 'xlarge' | 'xxlarge';
export type AssistanceMode = 'reactive' | 'reactive-proactive';
export type ProactiveFrequency = 'low' | 'medium' | 'high';

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
}
