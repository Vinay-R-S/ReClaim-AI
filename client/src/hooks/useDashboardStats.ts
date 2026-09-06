import { useCallback, useEffect, useState } from 'react';
import { authGet } from '../lib/api';
import type { DashboardStats } from '../types/domain';

/**
 * The admin dashboard, in one request.
 *
 * It used to read every item, every match and every handover into the browser
 * and count them there, on mount and again every thirty seconds (defect
 * PERF-07). The counts are Firestore aggregations now and the charts are
 * computed server side, so what arrives is the few hundred numbers the page
 * draws rather than the whole project.
 */
export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      setStats(await authGet<DashboardStats>('/api/stats/dashboard'));
      setError(null);
    } catch (err) {
      console.error('Failed to load dashboard stats:', err);
      setError(err instanceof Error ? err : new Error('Failed to load dashboard stats'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { stats, loading, error, reload: load };
}
