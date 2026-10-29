import type { SceneChangeCategory, SceneCheckResult } from '../../types/ai';
import type { SceneAlertDetail, SceneAlertFrequency, Settings } from '../../types/settings';
import { similarity } from './descriptionManager';

/** Observations older than this are not used for follow-up questions or change detection. */
export const SCENE_CONTEXT_TTL_MS = 3 * 60_000;
const MAX_RECORDS = 10;

export const ALERT_GAP_MS: Record<SceneAlertFrequency, number> = { low: 90_000, medium: 45_000, high: 20_000 };

export interface SceneRecord {
  summary: string;
  at: number;
  sessionId: string;
  confidence: SceneCheckResult['confidence'];
  objects: string[];
}

/** Short-lived, in-memory record of recent observations. Never saved and never turned into a personal memory. */
export function createSceneMemory(ttlMs = SCENE_CONTEXT_TTL_MS, now: () => number = () => Date.now()) {
  let records: SceneRecord[] = [];
  const prune = () => {
    const cutoff = now() - ttlMs;
    records = records.filter((r) => r.at >= cutoff).slice(0, MAX_RECORDS);
  };
  return {
    add(record: Omit<SceneRecord, 'at'> & { at?: number }) {
      records.unshift({ ...record, at: record.at ?? now() });
      prune();
    },
    /** Newest first, only for the given session, expired entries removed. */
    recent(sessionId: string): SceneRecord[] {
      prune();
      return records.filter((r) => r.sessionId === sessionId);
    },
    latest(sessionId: string): SceneRecord | undefined {
      return this.recent(sessionId)[0];
    },
    clear() {
      records = [];
    },
  };
}

export type SceneMemory = ReturnType<typeof createSceneMemory>;

export function isFresh(iso: string, now = Date.now(), ttlMs = SCENE_CONTEXT_TTL_MS): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= ttlMs;
}

/**
 * Phrases OpenEyes must never say from periodic frames: safety guarantees, movement commands,
 * and claims about motion or speed.
 */
const UNSAFE = [
  /\b(path|way|route|road|coast|area|street)\b[^.]*\b(is|looks|seems|appears)\s+(clear|safe|free)\b/i,
  /\b(safe|clear)\s+to\s+(walk|cross|go|move|proceed|step)\b/i,
  /\byou\s+(can|may|should)\s+(now\s+)?(cross|walk|go|move|proceed|step|turn)\b/i,
  /\bno\s+(obstacles?|hazards?|dangers?|cars?|traffic)\b/i,
  /\b(walk|step|move|go)\s+(forward|ahead|left|right|straight)\b/i,
  /\b(turn|veer)\s+(left|right)\b/i,
  /\b(it'?s|it is)\s+safe\b/i,
  /\b(moving|approaching|coming)\s+((toward|towards|at)\s+)?you\b/i,
  /\b(fast|quickly|speed|speeding|will (move|arrive|hit))\b/i,
];

export function isSafeAnnouncement(text: string): boolean {
  return !UNSAFE.some((p) => p.test(text));
}

/** Drops any sentence that breaks the safety rules. */
export function stripUnsafeSentences(text: string): string {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s && isSafeAnnouncement(s))
    .join(' ');
}

export interface AlertSettings {
  enabled: boolean;
  paused: boolean;
  categories: readonly SceneChangeCategory[];
  frequency: SceneAlertFrequency;
  detail: SceneAlertDetail;
}

export function alertSettingsFrom(s: Settings): AlertSettings {
  return {
    enabled: s.sceneAlerts,
    paused: s.sceneAlertsPaused,
    categories: s.sceneAlertCategories,
    frequency: s.sceneAlertFrequency,
    detail: s.sceneAlertDetail,
  };
}

export interface AlertState {
  lastAlertAt: number | null;
  /** Recently announced texts, to avoid repeating the same change. */
  recentAlerts: { text: string; at: number }[];
}

/**
 * Picks at most one descriptive announcement from a scene check. Returns null when nothing should
 * be said: alerts off or paused, too soon after the last one, low confidence, a category the user
 * did not choose, a repeat, or wording that breaks the safety rules.
 */
export function selectAnnouncement(
  result: Pick<SceneCheckResult, 'changes' | 'confidence' | 'summary'>,
  settings: AlertSettings,
  state: AlertState,
  now = Date.now(),
): string | null {
  if (!settings.enabled || settings.paused) return null;
  if (result.confidence === 'low') return null;
  if (state.lastAlertAt !== null && now - state.lastAlertAt < ALERT_GAP_MS[settings.frequency]) return null;
  const recent = state.recentAlerts.filter((a) => now - a.at <= SCENE_CONTEXT_TTL_MS);
  const change = result.changes.find(
    (c) =>
      settings.categories.includes(c.category) &&
      c.text.trim() &&
      isSafeAnnouncement(c.text) &&
      !recent.some((a) => similarity(a.text, c.text) >= 0.6),
  );
  if (!change) return null;
  const alert = change.text.trim().replace(/([^.!?])$/, '$1.');
  if (settings.detail === 'brief') return alert;
  const summary = stripUnsafeSentences(result.summary);
  return summary ? `${alert} ${summary}` : alert;
}
