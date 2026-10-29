import { MEMORY_CATEGORIES, type Memory, type MemoryCategory, type MemoryInput, type MemoryProvider } from '../../types/memory';
import { STORAGE_KEYS } from '../../utils/storage';
import { LIMITS, cleanText, validateRequiredText } from '../../utils/validation';
import { ValidationError, createLocalCollection, hasBaseFields } from '../storage/localCollection';

const SUBJECT_MAX = 80;

function isCategory(value: unknown): value is MemoryCategory {
  return typeof value === 'string' && (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

/** Only fields that were provided are returned, so an update merges onto the stored memory. */
function normalizeMemory(input: MemoryInput): MemoryInput {
  const result = validateRequiredText(input.text, 'Memory', LIMITS.memoryText);
  if (!result.ok) throw new ValidationError(result.error);
  const out: MemoryInput = { text: result.value };
  if (input.category !== undefined) {
    if (!isCategory(input.category)) throw new ValidationError('Choose a valid memory type.');
    out.category = input.category;
  }
  if (input.subject !== undefined) out.subject = cleanText(input.subject).slice(0, SUBJECT_MAX);
  if (input.dueAt !== undefined) {
    if (input.dueAt && Number.isNaN(Date.parse(input.dueAt))) throw new ValidationError('Enter a valid date.');
    out.dueAt = input.dueAt;
  }
  if (input.done !== undefined) out.done = Boolean(input.done);
  return out;
}

/** Kept as lenient as earlier versions so no stored memory is ever filtered out and lost on the next save. */
function isMemory(value: unknown): value is Memory {
  return hasBaseFields(value) && typeof value.text === 'string';
}

export function matchesQuery(text: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function createLocalMemoryProvider(storageKey: string = STORAGE_KEYS.memories): MemoryProvider {
  const collection = createLocalCollection<Memory, MemoryInput>({
    storageKey,
    normalize: normalizeMemory,
    isValid: isMemory,
  });
  return {
    ...collection,
    async search(query) {
      const items = await collection.list();
      const q = query.trim();
      return q ? items.filter((m) => matchesQuery(`${typeof m.subject === 'string' ? m.subject : ''} ${m.text}`, q)) : items;
    },
  };
}
