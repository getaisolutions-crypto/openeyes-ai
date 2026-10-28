import type { ExploreInterval, ExploreSessionMinutes, Settings } from '../../types/settings';
import { STORAGE_KEYS, readJSON, writeJSON } from '../../utils/storage';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  highContrast: false,
  textSize: 'normal',
  reduceMotion: false,
  voiceOutput: true,
  speechRate: 1,
  responseLength: 'standard',
  rememberConversation: false,
  cameraSource: 'phone',
  assistanceMode: 'reactive',
  proactiveFrequency: 'low',
  quietMode: false,
  voiceURI: '',
  exploreMode: 'ask',
  exploreIntervalSeconds: 8,
  exploreSessionMinutes: 10,
};

export const EXPLORE_INTERVALS: readonly ExploreInterval[] = [8, 12, 20, 30];
export const EXPLORE_SESSION_MINUTES: readonly ExploreSessionMinutes[] = [5, 10, 15];

const oneOfNumber = <T extends number>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export const SPEECH_RATE = { min: 0.5, max: 2, step: 0.1 } as const;

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/** Merges stored values with defaults, discarding anything invalid. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const rate = typeof s.speechRate === 'number' && Number.isFinite(s.speechRate) ? s.speechRate : d.speechRate;
  return {
    theme: oneOf(s.theme, ['dark', 'light'] as const, d.theme),
    highContrast: bool(s.highContrast, d.highContrast),
    textSize: oneOf(s.textSize, ['normal', 'large', 'xlarge', 'xxlarge'] as const, d.textSize),
    reduceMotion: bool(s.reduceMotion, d.reduceMotion),
    voiceOutput: bool(s.voiceOutput, d.voiceOutput),
    speechRate: Math.min(SPEECH_RATE.max, Math.max(SPEECH_RATE.min, Math.round(rate * 10) / 10)),
    responseLength: oneOf(s.responseLength, ['brief', 'standard', 'detailed'] as const, d.responseLength),
    rememberConversation: bool(s.rememberConversation, d.rememberConversation),
    // Glasses cannot be a camera source until the native integration exists.
    cameraSource: 'phone',
    assistanceMode: oneOf(s.assistanceMode, ['reactive', 'reactive-proactive'] as const, d.assistanceMode),
    proactiveFrequency: oneOf(s.proactiveFrequency, ['low', 'medium', 'high'] as const, d.proactiveFrequency),
    quietMode: bool(s.quietMode, d.quietMode),
    voiceURI: typeof s.voiceURI === 'string' && s.voiceURI.length <= 500 ? s.voiceURI : d.voiceURI,
    exploreMode: oneOf(s.exploreMode, ['ask', 'smart', 'continuous'] as const, d.exploreMode),
    exploreIntervalSeconds: oneOfNumber(s.exploreIntervalSeconds, EXPLORE_INTERVALS, d.exploreIntervalSeconds),
    exploreSessionMinutes: oneOfNumber(s.exploreSessionMinutes, EXPLORE_SESSION_MINUTES, d.exploreSessionMinutes),
  };
}

export function loadSettings(): Settings {
  return sanitizeSettings(readJSON<unknown>(STORAGE_KEYS.settings, {}));
}

export function saveSettings(settings: Settings): void {
  writeJSON(STORAGE_KEYS.settings, settings);
}
