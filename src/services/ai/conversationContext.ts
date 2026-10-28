import type { ChatMessage } from '../../types/ai';
import type { Memory } from '../../types/memory';

/** Maximum number of recent messages sent with each question. Older messages stay on screen only. */
export const CONTEXT_MESSAGE_LIMIT = 10;
export const MEMORY_CONTEXT_LIMIT = 5;

export function boundConversation(messages: ChatMessage[], limit: number = CONTEXT_MESSAGE_LIMIT): ChatMessage[] {
  const recent = messages.filter((m) => m.content.trim()).slice(-limit);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  return recent;
}

const REMEMBER = /^\s*(?:please\s+|can you\s+|could you\s+|openeyes,?\s+)?remember(?:\s+that)?[\s,:]+(.+?)\s*$/i;

/** Returns the note to save when the user asks OpenEyes to remember something, otherwise null. */
export function parseRememberRequest(text: string): string | null {
  const match = text.match(REMEMBER);
  if (!match) return null;
  const note = match[1].replace(/[\s.!]+$/, '').trim();
  if (!note || text.trim().endsWith('?')) return null;
  return `${note.charAt(0).toUpperCase()}${note.slice(1)}.`;
}

const STOP_WORDS = new Set(
  `a an and are at be can could did do does for from have how i if in is it its keep kept left me my of on or
  put so that the their them then there these they this to usually was what when where which who why will with
  you your always normally often please tell remember find`.split(/\s+/),
);

function keywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}

/** Picks saved memories that share meaningful words with the question, best matches first. */
export function selectRelevantMemories(
  memories: Memory[],
  question: string,
  limit: number = MEMORY_CONTEXT_LIMIT,
): Memory[] {
  const wanted = keywords(question);
  if (wanted.size === 0) return [];
  return memories
    .map((memory) => {
      let score = 0;
      for (const word of keywords(memory.text)) if (wanted.has(word)) score += 1;
      return { memory, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt))
    .slice(0, limit)
    .map((entry) => entry.memory);
}
