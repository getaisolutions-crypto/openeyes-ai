export interface CacheEnvironment {
  caches?: Pick<CacheStorage, 'keys' | 'delete'>;
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>;
  origin: string;
}

export interface CacheResetReport {
  cacheStorageSupported: boolean;
  deletedCaches: string[];
  serviceWorkersRemoved: number;
  problems: string[];
}

export function browserCacheEnvironment(): CacheEnvironment {
  return {
    caches: typeof caches === 'undefined' ? undefined : caches,
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
    origin: window.location.origin,
  };
}

/**
 * Removes cached app files for this site only. Cache Storage and service worker registrations are
 * scoped to the page's origin by the browser, so nothing belonging to other sites is reachable.
 * localStorage, sessionStorage and IndexedDB are never touched.
 */
export async function clearAppCaches(env: CacheEnvironment): Promise<CacheResetReport> {
  const report: CacheResetReport = {
    cacheStorageSupported: Boolean(env.caches),
    deletedCaches: [],
    serviceWorkersRemoved: 0,
    problems: [],
  };

  if (env.caches) {
    try {
      for (const name of await env.caches.keys()) {
        if (await env.caches.delete(name)) report.deletedCaches.push(name);
      }
    } catch {
      report.problems.push('Some cached files could not be removed.');
    }
  }

  if (env.serviceWorker) {
    try {
      for (const registration of await env.serviceWorker.getRegistrations()) {
        if (new URL(registration.scope).origin !== env.origin) continue;
        // OpenEyes ships no service worker, so any worker on this site is a leftover that can serve stale files.
        if (await registration.unregister()) report.serviceWorkersRemoved += 1;
      }
    } catch {
      report.problems.push('An old background worker could not be removed.');
    }
  }

  return report;
}
