import type { MemoryCategory, MemoryInput } from '../../types/memory';
import { normalizeItem } from '../find/objectSearch';
import type { ResponseLength } from '../../types/ai';

export interface MemoryProposal {
  input: MemoryInput;
  /** Spoken question asking for consent before anything is saved. */
  confirmPrompt: string;
  /** Spoken after the user confirms. */
  savedReply: string;
  /** Optional settings change the user is also agreeing to. */
  responseLength?: ResponseLength;
}

const PLACE_WORDS = '(?:on|in|under|inside|behind|beside|next to|near|by|at|on top of)';
const ITEM = '([a-z][a-z \'-]{0,40}?)';

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function asSentence(text: string): string {
  const t = capitalise(text.trim().replace(/[.!?]+$/, ''));
  return `${t}.`;
}

/** Extracts an item location from phrases like "I put my keys on the counter" or "my glasses are in the drawer". */
export function parseItemLocation(note: string): { item: string; location: string } | null {
  const text = note.trim().replace(/[.!?]+$/, '');
  const patterns = [
    new RegExp(`^(?:i\\s+(?:put|left|placed|keep|stored|hung)\\s+)(?:my|the|our)\\s+${ITEM}\\s+(${PLACE_WORDS}\\s+.+)$`, 'i'),
    new RegExp(`^(?:my|the|our)\\s+${ITEM}\\s+(?:is|are|was|were|is kept|are kept)\\s+(${PLACE_WORDS}\\s+.+)$`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { item: normalizeItem(match[1]).toLowerCase(), location: match[2].trim() };
  }
  return null;
}

function detectCategory(note: string): MemoryCategory {
  const t = note.toLowerCase();
  if (/\b(screen reader|talkback|large text|high contrast|speak (more )?slowly|slower speech|faster speech|braille|magnif)/.test(t)) {
    return 'accessibility';
  }
  if (/\b(i (prefer|like|love|hate|dislike|don't like|do not like)|my favou?rite)\b/.test(t)) return 'preference';
  if (/\b(every (morning|day|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|each (morning|day|evening)|usually|on weekdays)\b/.test(t)) {
    return 'routine';
  }
  if (/\bmy (phone number|address|doctor|pharmacy|wi-?fi|password hint|bus|postcode|zip code|email)\b/.test(t)) return 'info';
  return 'note';
}

/** Turns a confirmed "remember…" request into a proposal. Nothing is saved until the user agrees. */
export function proposeMemory(note: string): MemoryProposal {
  const location = parseItemLocation(note);
  if (location) {
    return {
      input: { text: asSentence(note), category: 'object-location', subject: location.item },
      confirmPrompt: 'Would you like me to remember that location?',
      savedReply: 'Saved.',
    };
  }
  const t = note.toLowerCase();
  const descriptionPref = /\b(prefer|like|want)\b.*\b(description|descriptions|answers|replies|responses)\b/.test(t);
  if (descriptionPref && /\b(short|shorter|brief|briefer|concise)\b/.test(t)) {
    return {
      input: { text: asSentence(note), category: 'preference' },
      confirmPrompt: 'Would you like me to save that as your description preference?',
      savedReply: "I'll use shorter descriptions from now on.",
      responseLength: 'brief',
    };
  }
  if (descriptionPref && /\b(long|longer|detailed|more detail)\b/.test(t)) {
    return {
      input: { text: asSentence(note), category: 'preference' },
      confirmPrompt: 'Would you like me to save that as your description preference?',
      savedReply: "I'll use more detailed descriptions from now on.",
      responseLength: 'detailed',
    };
  }
  return {
    input: { text: asSentence(note), category: detectCategory(note) },
    confirmPrompt: 'Would you like me to save this to My Memories?',
    savedReply: 'Saved to My Memories.',
  };
}

export const REMINDER_LIMITATION =
  "OpenEyes can't alert you when the app is closed or in the background, so check your reminders in My Memories.";

/** "Remind me to call John tomorrow" -> reminder text and an optional due date. */
export function parseReminderRequest(text: string, now = new Date()): MemoryInput | null {
  const match = text.trim().match(/^(?:openeyes,?\s+)?(?:please\s+)?remind me (?:to |about |that )?(.+?)[.!?]*$/i);
  if (!match || !match[1].trim()) return null;
  let body = match[1].trim();
  let dueAt: string | undefined;
  const day = new Date(now);
  day.setHours(9, 0, 0, 0);
  if (/\btomorrow\b/i.test(body)) {
    day.setDate(day.getDate() + 1);
    dueAt = day.toISOString();
    body = body.replace(/\s*\btomorrow\b/i, '').trim();
  } else if (/\b(today|tonight|this evening)\b/i.test(body)) {
    dueAt = day.toISOString();
    body = body.replace(/\s*\b(today|tonight|this evening)\b/i, '').trim();
  }
  if (!body) return null;
  return { text: asSentence(body), category: 'reminder', dueAt, done: false };
}

/** "Where did I leave my keys?" / "Where are my glasses?" -> "keys" / "glasses". */
export function parseWhereIsQuestion(text: string): string | null {
  const match = text
    .trim()
    .match(/^(?:openeyes,?\s+)?where (?:did i (?:leave|put|last put)|have i (?:left|put)|are|is|were|was) (?:my|the|our) (.+?)[?.!]*$/i);
  return match ? normalizeItem(match[1]).toLowerCase() : null;
}
