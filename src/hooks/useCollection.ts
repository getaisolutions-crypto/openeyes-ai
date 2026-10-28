import { useCallback, useEffect, useState } from 'react';
import type { CollectionItem, CollectionProvider } from '../types/memory';

export function useCollection<T extends CollectionItem, Input>(provider: CollectionProvider<T, Input>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await provider.list());
      setLoadError(null);
    } catch {
      setLoadError('Your saved items could not be loaded from this device.');
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: Input) => {
      const item = await provider.create(input);
      await refresh();
      return item;
    },
    [provider, refresh],
  );

  const update = useCallback(
    async (id: string, input: Input) => {
      const item = await provider.update(id, input);
      await refresh();
      return item;
    },
    [provider, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await provider.remove(id);
      await refresh();
    },
    [provider, refresh],
  );

  return { items, loading, loadError, create, update, remove, refresh };
}
