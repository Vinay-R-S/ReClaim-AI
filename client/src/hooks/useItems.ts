import { useCallback, useEffect, useState } from 'react';
import { getItems } from '../services/itemService';
import type { Item } from '../types/domain';

/**
 * The item list an admin screen works from.
 *
 * Seven screens each ran their own `getItems()` in a `useEffect` with their own
 * loading flag and their own swallowed error. The fetch, the flag and the
 * refresh live here so the screens are left with the part that differs: what
 * they filter for and how they draw it.
 */
export function useItems() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * `silent` refreshes without raising the loading flag, so a periodic reload
   * does not replace a populated screen with skeletons every interval.
   */
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      setItems(await getItems());
      setError(null);
    } catch (err) {
      console.error('Failed to load items:', err);
      setError(err instanceof Error ? err : new Error('Failed to load items'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, reload: load };
}
