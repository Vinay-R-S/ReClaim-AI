import { useCallback, useEffect, useState } from 'react';
import { handoverService } from '../services/handoverService';
import { authGet } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { HandoverRecord } from '../types/domain';

/**
 * Completed handovers.
 *
 * `scope: 'mine'` is the user's own list and `scope: 'all'` is the admin
 * history; they read different endpoints but the screens do the same three
 * things with the result.
 */
export function useHandovers(scope: 'mine' | 'all') {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [handovers, setHandovers] = useState<HandoverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  /**
   * `silent` refreshes without raising the loading flag, so a periodic reload
   * does not replace a populated screen with skeletons every interval.
   */
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (scope === 'mine' && !uid) return;

      if (!silent) setLoading(true);

      try {
        const records =
          scope === 'all'
            ? await handoverService.getHistory()
            : ((await authGet<{ handovers?: HandoverRecord[] }>(`/api/handovers/user/${uid}`))
                .handovers ?? []);

        setHandovers(records);
        setError(null);
      } catch (err) {
        console.error('Failed to load handovers:', err);
        setError(err instanceof Error ? err : new Error('Failed to load handovers'));
        setHandovers([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [scope, uid],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { handovers, loading, error, reload: load };
}
