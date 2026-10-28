import { contentWords, similarity } from '../explore/descriptionManager';

const WAKE = /^\s*(?:hey|hi|ok|okay)?[\s,]*open[\s-]?eyes\b[\s,.!?:]*/i;

/** Splits "Hey OpenEyes, what's in front of me?" into the wake phrase and the request after it. */
export function matchWakePhrase(text: string): { matched: boolean; rest: string } {
  const match = text.match(WAKE);
  if (!match) return { matched: false, rest: text.trim() };
  return { matched: true, rest: text.slice(match[0].length).trim() };
}

/**
 * True when what the microphone heard is probably OpenEyes' own voice coming back through the speaker.
 * Used only for the experimental hands-free interruption.
 */
export function isLikelyEcho(heard: string, spoken: string): boolean {
  const h = heard.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return true;
  const s = spoken.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ');
  if (s.includes(h)) return true;
  const words = contentWords(heard);
  const spokenWords = contentWords(spoken);
  if (words.size > 0 && [...words].every((w) => spokenWords.has(w))) return true;
  return similarity(heard, spoken) >= 0.5;
}
