import type { Memory, MemoryInput, MemoryProvider } from '../../types/memory';
import { STORAGE_KEYS } from '../../utils/storage';
import { LIMITS, validateRequiredText } from '../../utils/validation';
import { ValidationError, createLocalCollection, hasBaseFields } from '../storage/localCollection';

function normalizeMemory(input: MemoryInput): MemoryInput {
  const result = validateRequiredText(input.text, 'Memory', LIMITS.memoryText);
  if (!result.ok) throw new ValidationError(result.error);
  return { text: result.value };
}

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
      return q ? items.filter((m) => matchesQuery(m.text, q)) : items;
    },
  };
}
