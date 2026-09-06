import { useCallback, useEffect, useState } from 'react';
import { authGet, authPut } from '../lib/api';
import type { SystemSettings, SystemSettingsResponse } from '../types/domain';

/**
 * System settings, read once per screen that needs them.
 *
 * Five components fetched `/api/settings` inline, each with its own inline
 * response type and its own idea of what a failure meant: the heatmap treated
 * it as decoration, the sidebar defaulted CCTV to on, and the CCTV screen
 * defaulted it to on as well but only after logging. One read, one shape.
 */
export function useSettings() {
  const [settings, setSettings] = useState<SystemSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setSettings(await authGet<SystemSettingsResponse>('/api/settings'));
      setError(null);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError(err instanceof Error ? err : new Error('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: SystemSettings) => {
      await authPut('/api/settings', next);
      await load();
    },
    [load],
  );

  return { settings, loading, error, reload: load, save };
}
