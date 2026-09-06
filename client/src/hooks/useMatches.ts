import { useCallback, useEffect, useState } from 'react';
import { getAllMatches, getAllMatchesWithHistory } from '../services/matchService';
import type { Match } from '../types/domain';

interface UseMatchesOptions {
  /** Include archived matches, which the dashboard graphs need. */
  includeHistory?: boolean;
}

/**
 * Match records for the admin screens.
 *
 * `includeHistory` is the difference between the matches list, which shows what
 * is still open, and the dashboard, which plots what has happened over time.
 */
export function useMatches({ includeHistory = false }: UseMatchesOptions = {}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * `silent` refreshes without raising the loading flag, so a periodic reload
   * does not replace a populated screen with skeletons every interval.
   */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);

      try {
        setMatches(await (includeHistory ? getAllMatchesWithHistory() : getAllMatches()));
        setError(null);
      } catch (err) {
        console.error('Failed to load matches:', err);
        setError(err instanceof Error ? err : new Error('Failed to load matches'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [includeHistory],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { matches, loading, error, reload: load };
}
