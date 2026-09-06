import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import type { MatchOutcome } from '../components/item/ReportSuccessPanel';

/** How long to keep asking, and how often. */
const ATTEMPTS = 12;
const INTERVAL_MS = 2500;

/**
 * Watch a freshly created item for a match score.
 *
 * Matching runs after the create response, so the result has to be read back
 * off the item. Only `matchScore` counts: `bestCandidateScore` is written
 * precisely when nothing crossed the threshold, so announcing it as a match
 * would be the same lie the server stopped telling.
 *
 * Gives up quietly. A report with no match is the normal case, and matching
 * can outlast this window, so the panel says results may still arrive rather
 * than claiming there are none.
 */
export function useMatchPoll() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MatchOutcome | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    // Re-armed on every mount. StrictMode runs mount, cleanup, mount in
    // development, which left the ref false for the component's whole life and
    // made the poll return on its first tick without ever clearing its state.
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const poll = useCallback(async (itemId: string) => {
    if (!itemId) return;

    setPending(true);

    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));

      if (!mounted.current) return;

      try {
        const { item } = await apiGet<{
          item?: { matchScore?: number; matchedItemId?: string };
        }>(`/api/items/${itemId}`);

        if (typeof item?.matchScore === 'number' && item.matchScore > 0) {
          if (!mounted.current) return;
          setResult({ highestScore: item.matchScore, bestMatchId: item.matchedItemId });
          break;
        }
      } catch {
        // A failed poll is not a failed report; keep trying, then give up.
      }
    }

    if (mounted.current) setPending(false);
  }, []);

  return { pending, result, poll };
}
