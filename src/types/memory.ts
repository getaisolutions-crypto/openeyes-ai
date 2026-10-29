export interface CollectionItem {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export const MEMORY_CATEGORIES = [
  'note',
  'object-location',
  'preference',
  'accessibility',
  'routine',
  'reminder',
  'info',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  note: 'Note',
  'object-location': 'Item location',
  preference: 'Personal preference',
  accessibility: 'Accessibility preference',
  routine: 'Daily routine',
  reminder: 'Reminder',
  info: 'Frequently used information',
};

/** Older memories have no category; they are treated as notes. */
export interface Memory extends CollectionItem {
  text: string;
  category?: MemoryCategory;
  /** The item an object-location memory is about, for example "keys". */
  subject?: string;
  /** Reminders only: optional due date (ISO). Reminders never fire on their own. */
  dueAt?: string;
  done?: boolean;
}

export interface MemoryInput {
  text: string;
  category?: MemoryCategory;
  subject?: string;
  dueAt?: string;
  done?: boolean;
}

export function memoryCategory(memory: Pick<Memory, 'category'>): MemoryCategory {
  return (MEMORY_CATEGORIES as readonly string[]).includes(memory.category ?? '') ? memory.category! : 'note';
}

/** Generic async CRUD store, so local storage can later be swapped for a backend. */
export interface CollectionProvider<T extends CollectionItem, Input> {
  list(): Promise<T[]>;
  create(input: Input): Promise<T>;
  update(id: string, input: Input): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface MemoryProvider extends CollectionProvider<Memory, MemoryInput> {
  search(query: string): Promise<Memory[]>;
}

export interface TrustedContact extends CollectionItem {
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

export type TrustedContactInput = Pick<TrustedContact, 'name' | 'relationship' | 'phone' | 'email'>;

export type ContactsProvider = CollectionProvider<TrustedContact, TrustedContactInput>;
