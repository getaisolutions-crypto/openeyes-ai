import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createFakeVoice, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import {
  SCENE_CONTEXT_TTL_MS,
  createSceneMemory,
  isFresh,
  isSafeAnnouncement,
  selectAnnouncement,
  stripUnsafeSentences,
  type AlertSettings,
} from '../services/explore/sceneAwareness';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../services/settings/settingsStorage';
import { STORAGE_KEYS } from '../utils/storage';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

const on: AlertSettings = { enabled: true, paused: false, categories: ['person', 'door', 'stairs'], frequency: 'low', detail: 'brief' };
const empty = { lastAlertAt: null, recentAlerts: [] };
const scene = (changes: { category: 'person' | 'door' | 'stairs' | 'new-area' | 'object'; text: string }[], confidence: 'high' | 'medium' | 'low' = 'high') => ({
  summary: 'A hallway with a doorway.',
  changes,
  confidence,
});

describe('Scene context expiration', () => {
  it('keeps observations for a short time per camera session and then forgets them', () => {
    let t = 1_000_000;
    const memory = createSceneMemory(SCENE_CONTEXT_TTL_MS, () => t);
    memory.add({ summary: 'A kitchen.', sessionId: 'a', confidence: 'high', objects: ['kettle'] });
    memory.add({ summary: 'A desk.', sessionId: 'b', confidence: 'medium', objects: [] });
    expect(memory.latest('a')?.summary).toBe('A kitchen.');
    expect(memory.recent('a')).toHaveLength(1);
    t += SCENE_CONTEXT_TTL_MS + 1;
    expect(memory.latest('a')).toBeUndefined();
    expect(memory.recent('b')).toHaveLength(0);
  });

  it('caps the number of records and can be cleared', () => {
    const memory = createSceneMemory();
    for (let i = 0; i < 15; i++) memory.add({ summary: `View ${i}`, sessionId: 's', confidence: 'high', objects: [] });
    expect(memory.recent('s')).toHaveLength(10);
    expect(memory.latest('s')?.summary).toBe('View 14');
    memory.clear();
    expect(memory.recent('s')).toHaveLength(0);
  });

  it('treats old or invalid timestamps as stale', () => {
    const now = Date.parse('2025-01-01T12:00:00Z');
    expect(isFresh('2025-01-01T11:59:00Z', now)).toBe(true);
    expect(isFresh('2025-01-01T11:50:00Z', now)).toBe(false);
    expect(isFresh('not a date', now)).toBe(false);
  });
});

describe('Environmental announcement safety', () => {
  it.each([
    'The path is clear.',
    'It is safe to cross.',
    'You can cross now.',
    'There are no obstacles.',
    'Walk forward safely.',
    'Turn left at the door.',
    "It's safe here.",
    'A person is approaching you.',
    'A car is moving fast.',
  ])('never announces "%s"', (text) => {
    expect(isSafeAnnouncement(text)).toBe(false);
  });

  it('allows descriptive wording', () => {
    expect(isSafeAnnouncement('The door appears open.')).toBe(true);
    expect(isSafeAnnouncement('The current image shows a person near the doorway.')).toBe(true);
    expect(stripUnsafeSentences('A staircase is visible. The way looks clear. A rail is on the left.')).toBe(
      'A staircase is visible. A rail is on the left.',
    );
  });
});

describe('Environmental announcement selection', () => {
  const person = scene([{ category: 'person', text: 'A person is visible near the doorway' }]);

  it('says nothing when alerts are off, paused, or confidence is low', () => {
    expect(selectAnnouncement(person, { ...on, enabled: false }, empty, 0)).toBeNull();
    expect(selectAnnouncement(person, { ...on, paused: true }, empty, 0)).toBeNull();
    expect(selectAnnouncement({ ...person, confidence: 'low' }, on, empty, 0)).toBeNull();
  });

  it('announces a chosen category briefly, or with the summary in detailed mode', () => {
    expect(selectAnnouncement(person, on, empty, 0)).toBe('A person is visible near the doorway.');
    expect(selectAnnouncement(person, { ...on, detail: 'detailed' }, empty, 0)).toBe(
      'A person is visible near the doorway. A hallway with a doorway.',
    );
  });

  it('respects the category filter, the frequency gap and avoids repeats', () => {
    expect(selectAnnouncement(scene([{ category: 'object', text: 'A cup appears on the table' }]), on, empty, 0)).toBeNull();
    const recent = { lastAlertAt: 0, recentAlerts: [{ text: 'A person is visible near the doorway.', at: 0 }] };
    expect(selectAnnouncement(scene([{ category: 'door', text: 'The door appears open' }]), on, recent, 30_000)).toBeNull();
    expect(selectAnnouncement(scene([{ category: 'door', text: 'The door appears open' }]), on, recent, 100_000)).toBe(
      'The door appears open.',
    );
    expect(selectAnnouncement(person, on, recent, 100_000)).toBeNull();
  });

  it('drops changes whose wording breaks the safety rules', () => {
    expect(selectAnnouncement(scene([{ category: 'stairs', text: 'Stairs ahead, walk forward' }]), on, empty, 0)).toBeNull();
  });
});

describe('Environmental awareness settings', () => {
  it('defaults to conservative, opt-in settings', () => {
    expect(DEFAULT_SETTINGS.sceneAlerts).toBe(false);
    expect(DEFAULT_SETTINGS.sceneAlertFrequency).toBe('low');
    expect(DEFAULT_SETTINGS.sceneAlertDetail).toBe('brief');
    expect(DEFAULT_SETTINGS.sceneAlertsPaused).toBe(false);
  });

  it('removes invalid values', () => {
    const s = sanitizeSettings({ sceneAlerts: 'yes', sceneAlertFrequency: 'constant', sceneAlertCategories: ['door', 'cars', 'door'] });
    expect(s.sceneAlerts).toBe(false);
    expect(s.sceneAlertFrequency).toBe('low');
    expect(s.sceneAlertCategories).toEqual(['door']);
  });

  it('shows the controls in Settings with a clear mobility warning', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const section = within(await screen.findByRole('region', { name: /Environmental awareness/ }));
    expect(section.getByText(/Not a mobility aid/)).toBeInTheDocument();
    const pause = section.getByRole('switch', { name: /Pause announcements/ });
    expect(pause).toBeDisabled();
    await user.click(section.getByRole('switch', { name: /Enable scene change announcements/ }));
    expect(pause).toBeEnabled();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEYS.settings) ?? '{}').sceneAlerts).toBe(true);
  });
});

describe('Environmental announcements in Live Explore', () => {
  function setup(scenePayload: unknown) {
    window.localStorage.setItem(STORAGE_KEYS.liveExploreConsent, 'true');
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ exploreMode: 'smart', sceneAlerts: true }));
    const backend: OpenEyesBackend = {
      post: vi.fn(async () => ({ scene: scenePayload })),
      health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
    };
    const camera = createFakeCamera({
      capture: vi.fn(async () => ({
        blob: new Blob(['f'], { type: 'image/jpeg' }),
        previewUrl: 'blob:f',
        width: 640,
        height: 480,
        capturedAt: new Date().toISOString(),
        source: 'phone' as const,
      })),
      start: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
    });
    const voice = createFakeVoice({
      isSynthesisSupported: () => true,
      speak: vi.fn((_t: string, o: { onEnd?: () => void }) => o.onEnd?.()),
    });
    const services = createTestServices({ ...createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'), camera, voice });
    return { services, backend, voice };
  }

  it('announces a visible change as information and labels it as not a safety guarantee', async () => {
    const user = userEvent.setup();
    const { services, backend, voice } = setup({
      summary: 'A hallway. The path is clear.',
      objects: ['door'],
      changes: [{ category: 'door', text: 'The door appears open' }],
      confidence: 'high',
    });
    renderApp('/explore', services);
    await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
    const live = within(screen.getByRole('region', { name: 'Live Explore' }));
    expect(await live.findByText('The door appears open.')).toBeInTheDocument();
    expect(live.getByText(/Informational only/)).toBeInTheDocument();
    expect(backend.post).toHaveBeenCalledWith(expect.objectContaining({ task: 'scene_check' }), expect.anything());
    const said = vi.mocked(voice.speak).mock.calls.map((c) => c[0]);
    expect(said).toContain('The door appears open.');
    expect(said.join(' ')).not.toMatch(/path is clear/i);
  });

  it('stays quiet about low-confidence changes', async () => {
    const user = userEvent.setup();
    const { services, voice } = setup({
      summary: 'A blurry room.',
      objects: [],
      changes: [{ category: 'person', text: 'A person may be visible' }],
      confidence: 'low',
    });
    renderApp('/explore', services);
    await user.click(await screen.findByRole('button', { name: 'Start exploring' }));
    const live = within(screen.getByRole('region', { name: 'Live Explore' }));
    expect(await live.findByText('A blurry room.')).toBeInTheDocument();
    expect(vi.mocked(voice.speak).mock.calls.map((c) => c[0])).not.toContain('A person may be visible.');
    expect(live.queryByText(/Informational only/)).not.toBeInTheDocument();
  });
});
