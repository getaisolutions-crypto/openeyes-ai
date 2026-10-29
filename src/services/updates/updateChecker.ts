import { parseBuildInfo, type BuildInfo } from './buildInfo';

export const VERSION_MANIFEST_PATH = '/version.json';
const CHECK_TIMEOUT_MS = 10_000;

export type UpdateCheckFailure = 'offline' | 'timeout' | 'network' | 'http' | 'invalid';

export type UpdateCheckResult =
  | { status: 'up-to-date'; latest: BuildInfo }
  | { status: 'update-available'; latest: BuildInfo }
  | { status: 'failed'; reason: UpdateCheckFailure; message: string };

const FAILURE_MESSAGES: Record<UpdateCheckFailure, string> = {
  offline: 'You appear to be offline, so OpenEyes could not check for updates.',
  timeout: 'The update check took too long. Please try again.',
  network: 'OpenEyes could not reach the server to check for updates.',
  http: 'The server did not return version information.',
  invalid: 'The version information from the server could not be read.',
};

function failed(reason: UpdateCheckFailure): UpdateCheckResult {
  return { status: 'failed', reason, message: FAILURE_MESSAGES[reason] };
}

export interface UpdateCheckOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  isOnline?: () => boolean;
  timeoutMs?: number;
}

/** Asks the server which build is deployed, bypassing every HTTP cache, and compares it with the running build. */
export async function checkForUpdate(current: BuildInfo, options: UpdateCheckOptions = {}): Promise<UpdateCheckResult> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const isOnline = options.isOnline ?? (() => navigator.onLine !== false);
  if (!isOnline()) return failed('offline');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CHECK_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${VERSION_MANIFEST_PATH}?t=${now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
    } catch {
      return failed(controller.signal.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) return failed('http');

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A missing manifest falls through to the single-page fallback and returns HTML.
      return failed(controller.signal.aborted ? 'timeout' : 'invalid');
    }
    const latest = parseBuildInfo(body);
    if (!latest) return failed('invalid');
    return { status: latest.buildId === current.buildId ? 'up-to-date' : 'update-available', latest };
  } finally {
    clearTimeout(timer);
  }
}
