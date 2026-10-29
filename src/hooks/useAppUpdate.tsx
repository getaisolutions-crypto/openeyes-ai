import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAnnouncer } from './useAnnouncer';
import { formatVersion, type BuildInfo } from '../services/updates/buildInfo';
import { freshReloadUrl, recordReloadAttempt, type ReloadOutcome, type ReloadReason } from '../services/updates/reloadGuard';
import { createSessionRegistry, type SessionRegistry } from '../services/updates/sessionRegistry';
import type { UpdateCheckResult } from '../services/updates/updateChecker';
import type { UpdateService } from '../services/updates/updateService';

export const UPDATE_POLL_INTERVAL_MS = 30 * 60_000;
export const UPDATE_MIN_GAP_MS = 5 * 60_000;
export const UPDATE_AVAILABLE_MESSAGE = 'A new version of OpenEyes AI is available.';
export const RELOAD_BLOCKED_MESSAGE =
  'OpenEyes already reloaded without receiving the new version. Your browser or network may be holding an old copy. Your data is safe. Please refresh manually using the steps in Settings, App and updates.';
const RELOAD_FAILED_MESSAGE = 'OpenEyes could not reload. Your data is safe. Please try again.';

interface UpdateContextValue {
  current: BuildInfo;
  result: UpdateCheckResult | null;
  lastCheckedAt: number | null;
  checking: boolean;
  applying: boolean;
  error: string | null;
  outcome: ReloadOutcome;
  busyLabels: string[];
  bannerVisible: boolean;
  confirming: ReloadReason | null;
  checkNow: () => Promise<UpdateCheckResult>;
  requestConfirm: (reason: ReloadReason | null) => void;
  apply: (reason: ReloadReason) => Promise<void>;
  dismiss: () => void;
  registry: SessionRegistry;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ service, children }: { service: UpdateService; children: ReactNode }) {
  const { announce } = useAnnouncer();
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReloadReason | null>(null);
  const [busyLabels, setBusyLabels] = useState<string[]>([]);
  const lastCheckRef = useRef(0);
  const inFlightRef = useRef<Promise<UpdateCheckResult> | null>(null);
  const applyingRef = useRef(false);
  const announcedBuildRef = useRef<string | null>(null);

  const [registry] = useState(() => {
    const created: SessionRegistry = createSessionRegistry(() => setBusyLabels(created.busyLabels()));
    return created;
  });

  const runCheck = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    setChecking(true);
    lastCheckRef.current = Date.now();
    const pending = service
      .check()
      .then((next) => {
        setResult(next);
        setLastCheckedAt(Date.now());
        return next;
      })
      .finally(() => {
        inFlightRef.current = null;
        setChecking(false);
      });
    inFlightRef.current = pending;
    return pending;
  }, [service]);

  const checkNow = useCallback(async () => {
    announce('Checking for updates.');
    const next = await runCheck();
    if (next.status === 'up-to-date') announce(`OpenEyes AI is up to date, version ${next.latest.version}.`);
    else if (next.status === 'update-available') announce(`Update available, version ${next.latest.version}.`);
    else announce(`Update check failed. ${next.message}`, 'assertive');
    return next;
  }, [announce, runCheck]);

  useEffect(() => {
    const autoCheck = () => {
      if (applyingRef.current || document.visibilityState === 'hidden') return;
      if (lastCheckRef.current && Date.now() - lastCheckRef.current < UPDATE_MIN_GAP_MS) return;
      void runCheck();
    };
    autoCheck();
    const interval = window.setInterval(autoCheck, UPDATE_POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') autoCheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', autoCheck);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', autoCheck);
    };
  }, [runCheck]);

  const outcome = service.initialOutcome;
  useEffect(() => {
    if (outcome.kind === 'updated') announce(`OpenEyes AI updated to version ${service.current.version}.`);
    if (outcome.kind === 'reloaded') announce('Cached app files cleared. OpenEyes AI reloaded.');
    if (outcome.kind === 'unchanged') {
      const message = `OpenEyes reloaded, but the older version is still running. Your data is safe. ${
        outcome.canRetry ? 'You can try again.' : 'Please refresh manually using the steps in Settings.'
      }`;
      setError(message);
      announce(message, 'assertive');
    }
  }, [announce, outcome, service.current.version]);

  const apply = useCallback(
    async (reason: ReloadReason) => {
      if (applyingRef.current) return;
      applyingRef.current = true;
      setApplying(true);
      setConfirming(null);
      setError(null);
      announce('Stopping camera, microphone and speech. OpenEyes will reload now.', 'assertive');
      const fail = (message: string) => {
        applyingRef.current = false;
        setApplying(false);
        setError(message);
        announce(message, 'assertive');
      };
      try {
        registry.stopAll();
        service.stopSpeech();
        await service.clearCaches();
        const target = result?.status === 'update-available' ? result.latest.buildId : null;
        const allowed = recordReloadAttempt(
          service.storage,
          { reason, fromBuildId: service.current.buildId, targetBuildId: target },
          Date.now(),
        );
        if (!allowed) return fail(RELOAD_BLOCKED_MESSAGE);
        service.reload(freshReloadUrl(window.location.href, Date.now()));
      } catch {
        fail(RELOAD_FAILED_MESSAGE);
      }
    },
    [announce, registry, result, service],
  );

  const availableBuildId = result?.status === 'update-available' ? result.latest.buildId : null;
  const bannerVisible =
    availableBuildId !== null && availableBuildId !== dismissedBuildId && busyLabels.length === 0 && !applying;

  useEffect(() => {
    if (!bannerVisible || announcedBuildRef.current === availableBuildId) return;
    announcedBuildRef.current = availableBuildId;
    announce(UPDATE_AVAILABLE_MESSAGE);
  }, [announce, availableBuildId, bannerVisible]);

  const dismiss = useCallback(() => {
    setDismissedBuildId(availableBuildId);
    announce('Update postponed. You can update any time from Settings.');
  }, [announce, availableBuildId]);

  const value = useMemo<UpdateContextValue>(
    () => ({
      current: service.current,
      result,
      lastCheckedAt,
      checking,
      applying,
      error,
      outcome,
      busyLabels,
      bannerVisible,
      confirming,
      checkNow,
      requestConfirm: setConfirming,
      apply,
      dismiss,
      registry,
    }),
    [service, result, lastCheckedAt, checking, applying, error, outcome, busyLabels, bannerVisible, confirming, checkNow, apply, dismiss, registry],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useAppUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error('useAppUpdate must be used inside UpdateProvider');
  return value;
}

/** Lets a running feature be stopped before a reload, and marks sessions an update must not interrupt. Outside UpdateProvider it does nothing. */
export function useReloadParticipant(label: string, busy: boolean, stop: () => void) {
  const registry = useContext(UpdateContext)?.registry;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => registry?.register({ label, busy, stop: () => stopRef.current() }), [registry, label, busy]);
}

export function describeVersion(build: BuildInfo | null): string {
  return build ? formatVersion(build.version) : 'Unknown';
}
