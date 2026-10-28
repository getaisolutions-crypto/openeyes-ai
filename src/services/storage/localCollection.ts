import type { CollectionItem, CollectionProvider } from '../../types/memory';
import { createId } from '../../utils/id';
import { readJSON, writeJSON } from '../../utils/storage';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

interface LocalCollectionOptions<T extends CollectionItem, Input> {
  storageKey: string;
  /** Validates and cleans user input; throws ValidationError on invalid input. */
  normalize: (input: Input) => Input;
  /** Guards against malformed or tampered stored records. */
  isValid: (value: unknown) => value is T;
}

/** Device-local CRUD store backed by localStorage. Data never leaves this browser. */
export function createLocalCollection<T extends CollectionItem, Input>({
  storageKey,
  normalize,
  isValid,
}: LocalCollectionOptions<T, Input>): CollectionProvider<T, Input> {
  const load = (): T[] => {
    const raw = readJSON<unknown>(storageKey, []);
    return Array.isArray(raw) ? raw.filter(isValid) : [];
  };
  const save = (items: T[]) => writeJSON(storageKey, items);

  return {
    async list() {
      return load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async create(input) {
      const clean = normalize(input);
      const now = new Date().toISOString();
      const item = { ...clean, id: createId(), createdAt: now, updatedAt: now } as unknown as T;
      save([item, ...load()]);
      return item;
    },
    async update(id, input) {
      const clean = normalize(input);
      const items = load();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) throw new ValidationError('That item no longer exists.');
      const updated = { ...items[index], ...clean, updatedAt: new Date().toISOString() } as T;
      items[index] = updated;
      save(items);
      return updated;
    },
    async remove(id) {
      save(load().filter((item) => item.id !== id));
    },
  };
}

export function hasBaseFields(value: unknown): value is Record<string, unknown> & CollectionItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.createdAt === 'string' && typeof v.updatedAt === 'string';
}
