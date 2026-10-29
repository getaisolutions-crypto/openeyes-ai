import type { ObjectDetectionResult } from '../../types/ai';
import { memoryCategory, type Memory } from '../../types/memory';

/** Pause after each result before the next frame is analysed. Keeps API use and speech manageable. */
export const SCAN_INTERVAL_MS = 4000;
/** A continuous search stops on its own after this many frames; the user can keep looking again. */
export const MAX_SCANS_PER_ROUND = 8;

const SCAN_GUIDANCE = [
  'Move your camera slowly to your right.',
  'Now move it slowly to your left.',
  'Try pointing the camera a little lower, towards tables and surfaces.',
  'Try pointing the camera a little higher.',
];

export function scanGuidance(scanIndex: number): string {
  return SCAN_GUIDANCE[scanIndex % SCAN_GUIDANCE.length];
}

/** "my keys" -> "keys"; "the remote control" -> "remote control". */
export function normalizeItem(raw: string): string {
  return raw
    .trim()
    .replace(/[?.!,]+$/g, '')
    .replace(/^(my|the|a|an|our|your)\s+/i, '')
    .trim();
}

export function yourItem(item: string): string {
  const name = normalizeItem(item).toLowerCase();
  return name ? `your ${name}` : 'the item';
}

export function startPhrase(item: string): string {
  return `I'll look for ${yourItem(item)}. Move your camera slowly around the room.`;
}

/** A visible result with low confidence is treated as uncertain: never overstate a detection. */
export function isConfidentMatch(result: ObjectDetectionResult): boolean {
  return result.visibility === 'visible' && result.confidence !== 'low';
}

export function phraseSearchResult(result: ObjectDetectionResult, scanIndex: number): string {
  const item = yourItem(result.query);
  if (isConfidentMatch(result)) {
    const where = result.positionDescription ? `, ${result.positionDescription.replace(/\.$/, '')}` : '';
    return `I can see what appears to be ${item}${where}. This is the current camera view only.`;
  }
  if (result.visibility !== 'not-visible') {
    const where = result.positionDescription ? ` It might be ${result.positionDescription.replace(/\.$/, '')}.` : '';
    return `I may see ${item}, but I can't confirm from this angle.${where} ${result.suggestion || 'Try holding the camera steady a little closer.'}`.trim();
  }
  return `I can't see ${item} in this view. ${result.suggestion || scanGuidance(scanIndex)}`;
}

function sameItem(a: string, b: string): boolean {
  const x = normalizeItem(a).toLowerCase().replace(/s$/, '');
  const y = normalizeItem(b).toLowerCase().replace(/s$/, '');
  return Boolean(x) && (x === y || x.includes(y) || y.includes(x));
}

/** Most recent remembered location for an item, or null. Only user-confirmed memories exist, so this is never a detection. */
export function findRememberedLocation(memories: Memory[], item: string): Memory | null {
  const matches = memories
    .filter((m) => memoryCategory(m) === 'object-location' && sameItem(m.subject ?? '', item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return matches[0] ?? null;
}

export function formatSavedDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'at an unknown time';
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `today at ${time}` : `on ${date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
}

export function phraseRememberedLocation(memory: Memory, item: string, now = new Date()): string {
  const where = memory.text.replace(/\.$/, '');
  return `You last told me ${formatSavedDate(memory.updatedAt, now)}: ${where}. I haven't checked with the camera, so ${yourItem(item)} may have moved.`;
}

/** Turns "keys" + "on the kitchen counter" into the stored memory text. */
export function locationMemoryText(item: string, location: string): string {
  const name = normalizeItem(item);
  const place = location.trim().replace(/\.$/, '');
  const capital = name.charAt(0).toUpperCase() + name.slice(1);
  return `${capital}: ${place}.`;
}
