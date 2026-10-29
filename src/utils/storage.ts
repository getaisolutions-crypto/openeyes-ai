/** All OpenEyes data lives under this prefix in the browser's localStorage, on this device only. */
export const STORAGE_PREFIX = 'openeyes.';

export const STORAGE_KEYS = {
  settings: `${STORAGE_PREFIX}settings.v1`,
  memories: `${STORAGE_PREFIX}memories.v1`,
  contacts: `${STORAGE_PREFIX}contacts.v1`,
  conversation: `${STORAGE_PREFIX}conversation.v1`,
  liveExploreConsent: `${STORAGE_PREFIX}live-explore-consent.v1`,
  voiceConversationConsent: `${STORAGE_PREFIX}voice-conversation-consent.v1`,
  pausedTask: `${STORAGE_PREFIX}paused-task.v1`,
} as const;

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function removeKey(key: string): void {
  window.localStorage.removeItem(key);
}

export function clearAllAppData(): void {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
}
