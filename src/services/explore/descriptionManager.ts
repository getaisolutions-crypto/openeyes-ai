/** Decides whether a new live description is different enough to be spoken. Pure and deterministic. */

const STOP_WORDS = new Set(
  'a an the and or but of to in on at by for with from is are was were be been it its this that these those there here some any very appears appear seems seem looks look likely possibly maybe camera view image photo frame side part near next which what who also has have can see visible i you your'
    .split(' '),
);

/** Words that suggest something worth announcing even when the rest of the scene is similar. */
const ATTENTION_WORDS = new Set(['person', 'people', 'man', 'woman', 'child', 'dog', 'cat', 'car', 'bicycle', 'door', 'stairs', 'step', 'steps', 'sign', 'text', 'vehicle']);

export function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, '').replace(/s$/, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

export function similarity(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  let shared = 0;
  wa.forEach((w) => {
    if (wb.has(w)) shared++;
  });
  return shared / (wa.size + wb.size - shared);
}

export const SIMILARITY_THRESHOLD = 0.5;

export interface ChangeDecision {
  speak: boolean;
  reason: 'first' | 'changed' | 'new-attention-object' | 'similar';
}

/** Compares a description with recent ones. Recent is newest first. */
export function assessChange(next: string, recent: readonly string[], threshold = SIMILARITY_THRESHOLD): ChangeDecision {
  if (recent.length === 0) return { speak: true, reason: 'first' };
  const nextWords = contentWords(next);
  const seen = new Set<string>();
  recent.forEach((r) => contentWords(r).forEach((w) => seen.add(w)));
  for (const w of nextWords) {
    if (ATTENTION_WORDS.has(w) && !seen.has(w)) return { speak: true, reason: 'new-attention-object' };
  }
  const maxSimilarity = Math.max(...recent.map((r) => similarity(next, r)));
  return maxSimilarity >= threshold ? { speak: false, reason: 'similar' } : { speak: true, reason: 'changed' };
}
