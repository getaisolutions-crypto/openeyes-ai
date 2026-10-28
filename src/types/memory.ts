export interface CollectionItem {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Memory extends CollectionItem {
  text: string;
}

export interface MemoryInput {
  text: string;
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
