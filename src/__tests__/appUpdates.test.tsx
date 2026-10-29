import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import pkg from '../../package.json';
import { createFakeUpdates, createTestServices, renderApp } from '../test/utils';
import { AnnouncerProvider } from '../hooks/useAnnouncer';
import { UpdateProvider, useReloadParticipant, RELOAD_BLOCKED_MESSAGE } from '../hooks/useAppUpdate';
import { UpdateNotice, CLEAR_CACHE_CONFIRMATION } from '../components/UpdateNotice';
import { CURRENT_BUILD, parseBuildInfo, type BuildInfo } from '../services/updates/buildInfo';
import { checkForUpdate, VERSION_MANIFEST_PATH } from '../services/updates/updateChecker';
import { clearAppCaches, type CacheEnvironment } from '../services/updates/cacheReset';
import {
  MAX_RELOAD_ATTEMPTS,
  REFRESH_PARAM,
  freshReloadUrl,
  readReloadOutcome,
  recordReloadAttempt,
  withoutRefreshParam,
  type StorageLike,
} from '../services/updates/reloadGuard';
import { createSessionRegistry } from '../services/updates/sessionRegistry';
import type { UpdateService } from '../services/updates/updateService';
import { STORAGE_KEYS } from '../utils/storage';

const NEWER: BuildInfo = { version: '9.9.9', buildId: 'newer-build', builtAt: '2030-01-01T00:00:00.000Z' };

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

describe('build version', () => {
  it('embeds the package version and a unique build id at build time', () => {
    expect(CURRENT_BUILD.version).toBe(pkg.version);
    expect(CURRENT_BUILD.buildId).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(Number.isNaN(Date.parse(CURRENT_BUILD.builtAt))).toBe(false);
  });

  it('rejects manifests with the wrong shape', () => {
    expect(parseBuildInfo(null)).toBeNull();
    expect(parseBuildInfo('<!doctype html>')).toBeNull();
    expect(parseBuildInfo({ version: '1.0.0' })).toBeNull();
    expect(parseBuildInfo({ version: '', buildId: 'x' })).toBeNull();
    expect(parseBuildInfo({ version: '1.0.0', buildId: 'x'.repeat(200) })).toBeNull();
    expect(parseBuildInfo({ version: '1.0.0', buildId: 'abc' })).toEqual({ version: '1.0.0', buildId: 'abc', builtAt: '' });
  });
});

describe('checking for updates', () => {
  const online = () => true;

  it('requests the manifest with a unique address and without the HTTP cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(CURRENT_BUILD));
    await checkForUpdate(CURRENT_BUILD, { fetchImpl, now: () => 123, isOnline: online });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${VERSION_MANIFEST_PATH}?t=123`);
    expect(init.cache).toBe('no-store');
  });

  it('reports up to date only when the deployed build id matches', async () => {
    const same = await checkForUpdate(CURRENT_BUILD, { fetchImpl: async () => jsonResponse(CURRENT_BUILD), isOnline: online });
    expect(same).toEqual({ status: 'up-to-date', latest: CURRENT_BUILD });
  });

  it('detects a new build even when the version number is unchanged', async () => {
    const sameVersion = { ...CURRENT_BUILD, buildId: 'other-build' };
    const result = await checkForUpdate(CURRENT_BUILD, { fetchImpl: async () => jsonResponse(sameVersion), isOnline: online });
    expect(result).toEqual({ status: 'update-available', latest: sameVersion });
  });

  it.each([
    ['http', async () => new Response('missing', { status: 404 })],
    ['invalid', async () => new Response('<!doctype html><html></html>', { status: 200 })],
    ['invalid', async () => jsonResponse({ hello: 'world' })],
    ['network', async () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('fails with "%s" instead of claiming the app is current', async (reason, fetchImpl) => {
    const result = await checkForUpdate(CURRENT_BUILD, { fetchImpl: fetchImpl as typeof fetch, isOnline: online });
    expect(result.status).toBe('failed');
    expect(result).toMatchObject({ reason });
  });

  it('does not contact the server while offline', async () => {
    const fetchImpl = vi.fn();
    const result = await checkForUpdate(CURRENT_BUILD, { fetchImpl, isOnline: () => false });
    expect(result).toMatchObject({ status: 'failed', reason: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const result = await checkForUpdate(CURRENT_BUILD, { fetchImpl, isOnline: online, timeoutMs: 10 });
    expect(result).toMatchObject({ status: 'failed', reason: 'timeout' });
  });
});

describe('clearing cached app files', () => {
  function registration(scope: string) {
    return { scope, unregister: vi.fn(async () => true) } as unknown as ServiceWorkerRegistration;
  }

  it('deletes this site’s Cache Storage entries and keeps personal data', async () => {
    localStorage.setItem(STORAGE_KEYS.memories, '[{"id":"m1"}]');
    localStorage.setItem(STORAGE_KEYS.contacts, '[{"id":"c1"}]');
    localStorage.setItem(STORAGE_KEYS.settings, '{"theme":"light"}');
    const clearSpy = vi.spyOn(Storage.prototype, 'clear');
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const cacheStore = { keys: vi.fn(async () => ['app-shell', 'images']), delete: vi.fn(async () => true) };

    const report = await clearAppCaches({ caches: cacheStore, origin: 'https://openeyes.example' });

    expect(cacheStore.delete).toHaveBeenCalledWith('app-shell');
    expect(cacheStore.delete).toHaveBeenCalledWith('images');
    expect(report.deletedCaches).toEqual(['app-shell', 'images']);
    expect(clearSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEYS.memories)).toBe('[{"id":"m1"}]');
    expect(localStorage.getItem(STORAGE_KEYS.contacts)).toBe('[{"id":"c1"}]');
    expect(localStorage.getItem(STORAGE_KEYS.settings)).toBe('{"theme":"light"}');
    clearSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('unregisters only service workers that belong to this site', async () => {
    const own = registration('https://openeyes.example/');
    const foreign = registration('https://other.example/');
    const env: CacheEnvironment = {
      serviceWorker: { getRegistrations: async () => [own, foreign] },
      origin: 'https://openeyes.example',
    };
    const report = await clearAppCaches(env);
    expect(own.unregister).toHaveBeenCalled();
    expect(foreign.unregister).not.toHaveBeenCalled();
    expect(report.serviceWorkersRemoved).toBe(1);
  });

  it('still works in browsers without Cache Storage or service workers', async () => {
    const report = await clearAppCaches({ origin: 'https://openeyes.example' });
    expect(report).toEqual({ cacheStorageSupported: false, deletedCaches: [], serviceWorkersRemoved: 0, problems: [] });
  });

  it('reports problems instead of throwing', async () => {
    const report = await clearAppCaches({
      caches: { keys: async () => Promise.reject(new Error('denied')), delete: vi.fn() },
      origin: 'https://openeyes.example',
    });
    expect(report.problems).toHaveLength(1);
  });
});

describe('reload guard', () => {
  const from = CURRENT_BUILD.buildId;

  it('confirms the new build after an update reload', () => {
    const storage = memoryStorage();
    expect(recordReloadAttempt(storage, { reason: 'update', fromBuildId: 'old', targetBuildId: from }, 1000)).toBe(true);
    expect(readReloadOutcome(storage, CURRENT_BUILD, 2000)).toEqual({ kind: 'updated', reason: 'update' });
    expect(storage.data.size).toBe(0);
  });

  it('reports when the reload still shows the old build, once only', () => {
    const storage = memoryStorage();
    recordReloadAttempt(storage, { reason: 'update', fromBuildId: from, targetBuildId: 'newer' }, 1000);
    expect(readReloadOutcome(storage, CURRENT_BUILD, 2000)).toEqual({ kind: 'unchanged', reason: 'update', canRetry: true });
    expect(readReloadOutcome(storage, CURRENT_BUILD, 3000)).toEqual({ kind: 'none' });
  });

  it('blocks further reloads after repeated failures, preventing loops', () => {
    const storage = memoryStorage();
    const attempt = { reason: 'update' as const, fromBuildId: from, targetBuildId: 'newer' };
    for (let i = 0; i < MAX_RELOAD_ATTEMPTS; i += 1) {
      expect(recordReloadAttempt(storage, attempt, 1000 + i)).toBe(true);
      readReloadOutcome(storage, CURRENT_BUILD, 1000 + i);
    }
    expect(recordReloadAttempt(storage, attempt, 5000)).toBe(false);
    expect(recordReloadAttempt(storage, attempt, 5000 + 11 * 60_000)).toBe(true);
  });

  it('treats a cache-clearing reload of the same build as success', () => {
    const storage = memoryStorage();
    recordReloadAttempt(storage, { reason: 'clear-cache', fromBuildId: from, targetBuildId: null }, 1000);
    expect(readReloadOutcome(storage, CURRENT_BUILD, 2000)).toEqual({ kind: 'reloaded', reason: 'clear-cache' });
  });

  it('reloads the same route with a cache-busting marker and removes it afterwards', () => {
    const fresh = freshReloadUrl('https://openeyes.example/settings?x=1#voice', 42);
    const url = new URL(fresh);
    expect(url.origin).toBe('https://openeyes.example');
    expect(url.pathname).toBe('/settings');
    expect(url.hash).toBe('#voice');
    expect(url.searchParams.get(REFRESH_PARAM)).toBe('42');
    expect(withoutRefreshParam(fresh)).toBe('/settings?x=1#voice');
    expect(withoutRefreshParam('https://openeyes.example/settings')).toBeNull();
  });

  it('works when session storage is unavailable', () => {
    expect(recordReloadAttempt(null, { reason: 'update', fromBuildId: from, targetBuildId: null }, 1)).toBe(true);
    expect(readReloadOutcome(null, CURRENT_BUILD, 1)).toEqual({ kind: 'none' });
  });
});

describe('session registry', () => {
  it('stops every registered feature even if one fails', () => {
    const registry = createSessionRegistry(() => undefined);
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error('boom');
    });
    const c = vi.fn();
    registry.register({ label: 'A', busy: true, stop: a });
    registry.register({ label: 'B', busy: false, stop: b });
    const unregister = registry.register({ label: 'C', busy: true, stop: c });
    expect(registry.busyLabels()).toEqual(['A', 'C']);
    unregister();
    expect(registry.stopAll()).toBe(1);
    expect(a).toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
  });
});

describe('App & updates in Settings', () => {
  it('shows the current version and an up-to-date status', async () => {
    renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'App & updates' });
    expect(await within(section).findByText('Up to date')).toBeInTheDocument();
    expect(within(section).getByText('Current version').nextElementSibling).toHaveTextContent(`v${CURRENT_BUILD.version}`);
  });

  it('never claims to be up to date when the check fails', async () => {
    const updates = createFakeUpdates({
      check: vi.fn(async () => ({ status: 'failed' as const, reason: 'network' as const, message: 'OpenEyes could not reach the server.' })),
    });
    renderApp('/settings', createTestServices({ updates }));
    const section = await screen.findByRole('region', { name: 'App & updates' });
    expect(await within(section).findByText('Could not check')).toBeInTheDocument();
    expect(within(section).queryByText('Up to date')).toBeNull();
    expect(within(section).getByText(/does not mean you have the latest version/)).toBeInTheDocument();
  });

  it('checks again when asked and announces the result', async () => {
    const updates = createFakeUpdates();
    renderApp('/settings', createTestServices({ updates }));
    const section = await screen.findByRole('region', { name: 'App & updates' });
    await within(section).findByText('Up to date');
    await userEvent.click(within(section).getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByTestId('live-polite')).toHaveTextContent(/up to date/));
    expect(updates.check).toHaveBeenCalledTimes(2);
  });

  it('clears caches after confirmation and reloads the same route, keeping personal data', async () => {
    localStorage.setItem(STORAGE_KEYS.memories, '[{"id":"keep-me"}]');
    const updates = createFakeUpdates();
    renderApp('/settings', createTestServices({ updates }));
    const section = await screen.findByRole('region', { name: 'App & updates' });
    await userEvent.click(within(section).getByRole('button', { name: 'Clear cache & reload' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(CLEAR_CACHE_CONFIRMATION);
    expect(updates.clearCaches).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear cache and reload' }));

    await waitFor(() => expect(updates.reload).toHaveBeenCalledTimes(1));
    expect(updates.stopSpeech).toHaveBeenCalled();
    expect(updates.clearCaches).toHaveBeenCalled();
    const target = new URL(vi.mocked(updates.reload).mock.calls[0][0]);
    expect(target.origin).toBe(window.location.origin);
    expect(target.searchParams.has(REFRESH_PARAM)).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.memories)).toBe('[{"id":"keep-me"}]');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const updates = createFakeUpdates();
    renderApp('/settings', createTestServices({ updates }));
    const section = await screen.findByRole('region', { name: 'App & updates' });
    await userEvent.click(within(section).getByRole('button', { name: 'Clear cache & reload' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(updates.clearCaches).not.toHaveBeenCalled();
    expect(updates.reload).not.toHaveBeenCalled();
  });
});

function Busy({ label, busy, stop }: { label: string; busy: boolean; stop: () => void }) {
  useReloadParticipant(label, busy, stop);
  return null;
}

function renderUpdater(service: UpdateService, busy = false, stop = vi.fn()) {
  const view = render(
    <AnnouncerProvider>
      <UpdateProvider service={service}>
        <Busy label="Live Explore" busy={busy} stop={stop} />
        <UpdateNotice />
      </UpdateProvider>
    </AnnouncerProvider>,
  );
  return {
    ...view,
    setBusy: (next: boolean) =>
      view.rerender(
        <AnnouncerProvider>
          <UpdateProvider service={service}>
            <Busy label="Live Explore" busy={next} stop={stop} />
            <UpdateNotice />
          </UpdateProvider>
        </AnnouncerProvider>,
      ),
  };
}

describe('update notification', () => {
  const available = () => createFakeUpdates({ check: vi.fn(async () => ({ status: 'update-available' as const, latest: NEWER })) });

  it('announces a new version with Update now and Later', async () => {
    renderUpdater(available());
    expect(await screen.findByText('A new version of OpenEyes AI is available.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('live-polite')).toHaveTextContent('A new version of OpenEyes AI is available.'));
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version of OpenEyes AI is available.')).toBeNull();
  });

  it('waits while Live Explore or a voice conversation is running', async () => {
    const service = available();
    const { setBusy } = renderUpdater(service, true);
    await waitFor(() => expect(service.check).toHaveBeenCalled());
    expect(screen.queryByText('A new version of OpenEyes AI is available.')).toBeNull();
    expect(service.reload).not.toHaveBeenCalled();
    setBusy(false);
    expect(await screen.findByText('A new version of OpenEyes AI is available.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('stops active sessions and speech before reloading', async () => {
    const service = available();
    const stop = vi.fn();
    renderUpdater(service, false, stop);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 5000 });
    expect(dialog).toHaveTextContent(/memories, trusted contacts, and personal settings will be kept/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update and reload' }));
    await waitFor(() => expect(service.reload).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(stop).toHaveBeenCalled();
    expect(service.stopSpeech).toHaveBeenCalled();
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(service.reload).mock.invocationCallOrder[0]);
  });

  it('refuses to reload again after repeated failed updates and offers a retry', async () => {
    const storage = memoryStorage();
    const service = { ...available(), storage };
    for (let i = 0; i < MAX_RELOAD_ATTEMPTS; i += 1) {
      recordReloadAttempt(storage, { reason: 'update', fromBuildId: CURRENT_BUILD.buildId, targetBuildId: NEWER.buildId }, Date.now());
    }
    renderUpdater(service);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    await userEvent.click(within(await screen.findByRole('alertdialog', {}, { timeout: 5000 })).getByRole('button', { name: 'Update and reload' }));
    expect(await screen.findByText(RELOAD_BLOCKED_MESSAGE, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(service.reload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a clear error when the reload did not deliver the new build', async () => {
    renderUpdater(createFakeUpdates({ initialOutcome: { kind: 'unchanged', reason: 'update', canRetry: true } }));
    expect(await screen.findByText(/older version is still running. Your data is safe/, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows an error and allows retry when reloading throws', async () => {
    const service = available();
    vi.mocked(service.reload).mockImplementation(() => {
      throw new Error('blocked');
    });
    renderUpdater(service);
    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));
    await userEvent.click(within(await screen.findByRole('alertdialog', {}, { timeout: 5000 })).getByRole('button', { name: 'Update and reload' }));
    expect(await screen.findByText(/could not reload/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
