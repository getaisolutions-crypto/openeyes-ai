import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeCamera, createTestServices, renderApp } from '../test/utils';
import { createMetaProviders } from '../services/ai/metaProviders';
import type { OpenEyesBackend } from '../services/ai/openEyesBackend';
import { AIRequestError, type ObjectDetectionResult } from '../types/ai';
import type { CapturedImage } from '../types/camera';
import type { Memory } from '../types/memory';
import { createLocalMemoryProvider } from '../services/memory/localMemoryProvider';
import {
  MAX_SCANS_PER_ROUND,
  SCAN_INTERVAL_MS,
  findRememberedLocation,
  normalizeItem,
  phraseRememberedLocation,
  phraseSearchResult,
} from '../services/find/objectSearch';

beforeAll(() => {
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined;
});

const frame = (): CapturedImage => ({
  blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
  previewUrl: 'blob:frame',
  width: 640,
  height: 480,
  capturedAt: new Date().toISOString(),
  source: 'phone',
});

const result = (overrides: Partial<ObjectDetectionResult>): ObjectDetectionResult => ({
  query: 'keys',
  visibility: 'not-visible',
  positionDescription: '',
  confidence: 'medium',
  suggestion: '',
  matches: [],
  modelId: 'muse-spark',
  ...overrides,
});

function memory(overrides: Partial<Memory>): Memory {
  return { id: 'm1', text: 'Keys: on the kitchen counter.', createdAt: '2024-01-01T10:00:00Z', updatedAt: '2024-01-01T10:00:00Z', ...overrides };
}

describe('object search wording', () => {
  it('uses camera-relative wording for confident matches and never overstates', () => {
    expect(
      phraseSearchResult(result({ visibility: 'visible', confidence: 'high', positionDescription: 'on the table, near the laptop' }), 0),
    ).toBe('I can see what appears to be your keys, on the table, near the laptop. This is the current camera view only.');
  });

  it('treats uncertain and low-confidence answers as unconfirmed', () => {
    expect(phraseSearchResult(result({ visibility: 'uncertain' }), 0)).toMatch(/^I may see your keys, but I can't confirm from this angle\./);
    expect(phraseSearchResult(result({ visibility: 'visible', confidence: 'low' }), 0)).toMatch(/^I may see your keys/);
  });

  it('suggests a scanning direction when the item is not visible', () => {
    expect(phraseSearchResult(result({}), 0)).toBe("I can't see your keys in this view. Move your camera slowly to your right.");
  });

  it('normalises spoken item names', () => {
    expect(normalizeItem('my keys?')).toBe('keys');
    expect(normalizeItem('the remote control')).toBe('remote control');
  });

  it('labels remembered locations as past information, not observations', () => {
    const saved = memory({ category: 'object-location', subject: 'keys' });
    expect(findRememberedLocation([saved, memory({ id: 'm2', text: 'Keys are nice' })], 'my key')).toBe(saved);
    const phrase = phraseRememberedLocation(saved, 'keys', new Date('2024-02-01T10:00:00Z'));
    expect(phrase).toMatch(/^You last told me on .*: Keys: on the kitchen counter\. I haven't checked with the camera/);
  });

  it('ignores memories that are not item locations', () => {
    expect(findRememberedLocation([memory({})], 'keys')).toBeNull();
  });
});

describe('live object search', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  function setup(answers: Array<() => Promise<Record<string, unknown>>>) {
    let inFlight = 0;
    let maxInFlight = 0;
    let call = 0;
    const backend: OpenEyesBackend = {
      post: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          return await answers[Math.min(call++, answers.length - 1)]();
        } finally {
          inFlight--;
        }
      }),
      health: vi.fn(async () => ({ configured: true, model: 'muse-spark-1.3' })),
    };
    const camera = createFakeCamera({ capture: vi.fn(async () => frame()) });
    const services = createTestServices({
      ...createMetaProviders(backend, async () => 'data:image/jpeg;base64,/9j/AAAA'),
      camera,
    });
    return { services, backend, camera, maxInFlight: () => maxInFlight };
  }

  const notVisible = async () => ({ find: { visibility: 'not_visible', position: '', confidence: 'medium', suggestion: '' } });
  const visible = async () => ({
    find: { visibility: 'visible', position: 'on the table, near the laptop', confidence: 'high', suggestion: '' },
  });
  const panel = () => screen.getByRole('region', { name: 'Search with the live camera' });
  const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  async function startSearch(u: ReturnType<typeof user>, item = 'Keys') {
    await u.click(await screen.findByRole('button', { name: item }));
    await u.click(screen.getByRole('button', { name: `Start live search for ${item}` }));
  }

  it('scans frames one at a time and stops when the item is found', async () => {
    const u = user();
    const { services, backend, maxInFlight } = setup([notVisible, visible]);
    renderApp('/find', services);
    await startSearch(u);
    expect(await within(panel()).findByText("I'll look for your keys. Move your camera slowly around the room.")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(await within(panel()).findByText(/I can't see your keys in this view/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS + 100));
    expect(await within(panel()).findByText(/I can see what appears to be your keys, on the table, near the laptop/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 3));
    expect(backend.post).toHaveBeenCalledTimes(2);
    expect(maxInFlight()).toBe(1);
    expect(screen.getByRole('button', { name: 'Keep looking' })).toBeInTheDocument();
  });

  it('reports uncertainty instead of claiming a detection', async () => {
    const u = user();
    const { services } = setup([
      async () => ({ find: { visibility: 'uncertain', position: 'near the centre of the image', confidence: 'low', suggestion: '' } }),
    ]);
    renderApp('/find', services);
    await startSearch(u);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(await within(panel()).findByText(/I may see your keys, but I can't confirm from this angle/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remember this location' })).not.toBeInTheDocument();
  });

  it('releases the camera and sends nothing more after Stop search', async () => {
    const u = user();
    const { services, backend, camera } = setup([notVisible]);
    renderApp('/find', services);
    await startSearch(u);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await within(panel()).findByText(/I can't see your keys/);
    await u.click(screen.getByRole('button', { name: 'Stop search' }));
    expect(camera.stop).toHaveBeenCalled();
    const calls = (backend.post as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 3));
    expect(backend.post).toHaveBeenCalledTimes(calls);
    expect(within(panel()).getByText('Search stopped. The camera is off.')).toBeInTheDocument();
  });

  it('pauses after a round of frames to limit usage', async () => {
    const u = user();
    const { services, backend } = setup([notVisible]);
    renderApp('/find', services);
    await startSearch(u);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    for (let i = 0; i < MAX_SCANS_PER_ROUND + 2; i++) await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS + 50));
    expect(await within(panel()).findByText(/I paused the search to save data/)).toBeInTheDocument();
    expect(backend.post).toHaveBeenCalledTimes(MAX_SCANS_PER_ROUND);
  });

  it('recovers from an AI failure with Keep looking', async () => {
    const u = user();
    const { services } = setup([
      async () => {
        throw new AIRequestError('rate-limited', 'OpenEyes is busy. Please wait a moment.');
      },
      visible,
    ]);
    renderApp('/find', services);
    await startSearch(u);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(await within(panel()).findByText(/The search stopped/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Keep looking' }));
    await act(() => vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS));
    expect(await within(panel()).findByText(/I can see what appears to be your keys/)).toBeInTheDocument();
  });

  it('saves a location only after confirmation and shows it as a past note', async () => {
    const u = user();
    const { services } = setup([visible]);
    renderApp('/find', services);
    await startSearch(u);
    await act(() => vi.advanceTimersByTimeAsync(1600));
    await within(panel()).findByText(/I can see what appears to be your keys/);
    expect(await createLocalMemoryProvider().list()).toHaveLength(0);
    await u.click(screen.getByRole('button', { name: 'Remember this location' }));
    const dialog = screen.getByRole('dialog', { name: 'Remember this location?' });
    const field = within(dialog).getByLabelText('Location');
    await u.clear(field);
    await u.type(field, 'on the kitchen counter');
    await u.click(within(dialog).getByRole('button', { name: 'Save location' }));
    await waitFor(async () => expect(await createLocalMemoryProvider().list()).toHaveLength(1));
    const [saved] = await createLocalMemoryProvider().list();
    expect(saved).toMatchObject({ category: 'object-location', subject: 'keys', text: 'Keys: on the kitchen counter.' });
    expect(await screen.findByText(/You last told me today at .*: Keys: on the kitchen counter\. I haven't checked/)).toBeInTheDocument();
  });
});
