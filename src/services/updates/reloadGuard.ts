import type { BuildInfo } from './buildInfo';

const STORAGE_KEY = 'openeyes.update-reload.v1';
export const REFRESH_PARAM = '_oe_refresh';
export const MAX_RELOAD_ATTEMPTS = 2;
const ATTEMPT_WINDOW_MS = 10 * 60_000;

export type ReloadReason = 'update' | 'clear-cache';
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface PendingReload {
  reason: ReloadReason;
  fromBuildId: string;
  targetBuildId: string | null;
  attempts: number;
  startedAt: number;
  settled: boolean;
}

export type ReloadOutcome =
  | { kind: 'none' }
  | { kind: 'updated'; reason: ReloadReason }
  | { kind: 'reloaded'; reason: 'clear-cache' }
  | { kind: 'unchanged'; reason: 'update'; canRetry: boolean };

export function browserSessionStorage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(storage: StorageLike): PendingReload | null {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as PendingReload | null;
    return value && typeof value.fromBuildId === 'string' && typeof value.attempts === 'number' ? value : null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike, value: PendingReload) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the reload still works, it just cannot be verified */
  }
}

/** Records a reload attempt. Returns false when recent attempts already failed, to stop reload loops. */
export function recordReloadAttempt(
  storage: StorageLike | null,
  attempt: { reason: ReloadReason; fromBuildId: string; targetBuildId: string | null },
  now: number,
): boolean {
  if (!storage) return true;
  const previous = read(storage);
  const recent = previous && now - previous.startedAt < ATTEMPT_WINDOW_MS && previous.reason === attempt.reason;
  const attempts = recent ? previous.attempts + 1 : 1;
  if (attempts > MAX_RELOAD_ATTEMPTS) return false;
  write(storage, { ...attempt, attempts, startedAt: recent ? previous.startedAt : now, settled: false });
  return true;
}

/** Called once at startup to learn whether the previous reload delivered the expected build. Never triggers a reload. */
export function readReloadOutcome(storage: StorageLike | null, current: BuildInfo, now: number): ReloadOutcome {
  if (!storage) return { kind: 'none' };
  const pending = read(storage);
  if (!pending || pending.settled) return { kind: 'none' };
  if (now - pending.startedAt > ATTEMPT_WINDOW_MS) {
    storage.removeItem(STORAGE_KEY);
    return { kind: 'none' };
  }

  const changed = current.buildId !== pending.fromBuildId || current.buildId === pending.targetBuildId;
  if (changed) {
    storage.removeItem(STORAGE_KEY);
    return { kind: 'updated', reason: pending.reason };
  }
  if (pending.reason === 'clear-cache') {
    storage.removeItem(STORAGE_KEY);
    return { kind: 'reloaded', reason: 'clear-cache' };
  }
  write(storage, { ...pending, settled: true });
  return { kind: 'unchanged', reason: 'update', canRetry: pending.attempts < MAX_RELOAD_ATTEMPTS };
}

/** Same page and route, with a unique query so the browser and CDN must fetch a fresh page. */
export function freshReloadUrl(href: string, now: number): string {
  const url = new URL(href);
  url.searchParams.set(REFRESH_PARAM, String(now));
  return url.toString();
}

/** Returns the address without the refresh marker, or null when there is nothing to remove. */
export function withoutRefreshParam(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(REFRESH_PARAM)) return null;
  url.searchParams.delete(REFRESH_PARAM);
  return url.pathname + url.search + url.hash;
}
