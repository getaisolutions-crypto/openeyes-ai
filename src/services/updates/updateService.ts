import { CURRENT_BUILD, type BuildInfo } from './buildInfo';
import { browserCacheEnvironment, clearAppCaches, type CacheResetReport } from './cacheReset';
import { browserSessionStorage, readReloadOutcome, type ReloadOutcome, type StorageLike } from './reloadGuard';
import { checkForUpdate, type UpdateCheckResult } from './updateChecker';

export interface UpdateService {
  current: BuildInfo;
  /** Result of the reload that started this page, read once when the service is created. */
  initialOutcome: ReloadOutcome;
  storage: StorageLike | null;
  check: () => Promise<UpdateCheckResult>;
  clearCaches: () => Promise<CacheResetReport>;
  stopSpeech: () => void;
  reload: (url: string) => void;
}

export function createBrowserUpdateService(): UpdateService {
  const storage = browserSessionStorage();
  return {
    current: CURRENT_BUILD,
    initialOutcome: readReloadOutcome(storage, CURRENT_BUILD, Date.now()),
    storage,
    check: () => checkForUpdate(CURRENT_BUILD),
    clearCaches: () => clearAppCaches(browserCacheEnvironment()),
    stopSpeech: () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    reload: (url) => window.location.replace(url),
  };
}
