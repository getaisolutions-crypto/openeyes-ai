export interface BuildInfo {
  version: string;
  /** Unique per production build, so two builds of the same version still differ. */
  buildId: string;
  builtAt: string;
}

export const CURRENT_BUILD: BuildInfo = __APP_BUILD__;

export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (!value || typeof value !== 'object') return null;
  const { version, buildId, builtAt } = value as Record<string, unknown>;
  if (typeof version !== 'string' || typeof buildId !== 'string') return null;
  if (!version || !buildId || version.length > 40 || buildId.length > 80) return null;
  return { version, buildId, builtAt: typeof builtAt === 'string' ? builtAt : '' };
}

export function formatVersion(version: string): string {
  return `v${version}`;
}
