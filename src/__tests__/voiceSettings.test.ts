import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../services/settings/settingsStorage';

describe('voice conversation settings', () => {
  it('defaults to hands-free with experimental features off', () => {
    expect(DEFAULT_SETTINGS.conversationHandsFree).toBe(true);
    expect(DEFAULT_SETTINGS.conversationWakePhrase).toBe(false);
    expect(DEFAULT_SETTINGS.conversationBargeIn).toBe(false);
    expect(DEFAULT_SETTINGS.voiceDiagnostics).toBe(false);
  });

  it('rejects invalid stored values', () => {
    const s = sanitizeSettings({ conversationHandsFree: 'yes', conversationWakePhrase: 1, conversationBargeIn: true, voiceDiagnostics: null });
    expect(s.conversationHandsFree).toBe(true);
    expect(s.conversationWakePhrase).toBe(false);
    expect(s.conversationBargeIn).toBe(true);
    expect(s.voiceDiagnostics).toBe(false);
  });
});
