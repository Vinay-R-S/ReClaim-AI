import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { authGet } from '../lib/authApi';

interface CreditsResponse {
  userId: string;
  credits: number;
}

/**
 * One credit balance, shared by every screen that shows it.
 *
 * The header used to keep its own copy in `sessionStorage` for five minutes
 * and refresh it only on a `creditUpdate` event that nothing in the app ever
 * dispatched, so the badge sat stale after a handover awarded credits (defect
 * UI-09). Credits are awarded server side, often by the other party's action,
 * so the balance is re-read rather than predicted: on mount, when the tab is
 * looked at again, and whenever a caller asks through `refresh`.
 */
interface CreditsState {
  credits: number | null;
  uid: string | null;
  loading: boolean;
}

let state: CreditsState = { credits: null, uid: null, loading: false };
const listeners = new Set<(next: CreditsState) => void>();
let inFlight: Promise<void> | null = null;
let inFlightUid: string | null = null;
let lastFetchedAt = 0;

/**
 * Quiet period between reads. Every screen renders its own `UserLayout`, so a
 * navigation remounts the badge, and a tab switch fires both `focus` and
 * `visibilitychange`. Without this the balance would be re-read several times
 * a minute for a number that moves once a handover.
 */
const MIN_REFETCH_MS = 15_000;

function setState(next: Partial<CreditsState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener(state));
}

async function fetchCredits(uid: string, force = false): Promise<void> {
  // Several screens mount at once and all want the same balance. Only fold in
  // a request that is for the same account: a sign-in as someone else must not
  // be answered by the previous user's in-flight read.
  if (inFlight && inFlightUid === uid) return inFlight;

  const fresh = state.credits !== null && Date.now() - lastFetchedAt < MIN_REFETCH_MS;
  if (!force && fresh) return undefined;

  inFlightUid = uid;
  setState({ loading: true });

  inFlight = authGet<CreditsResponse>(`/api/credits/${uid}`)
    .then((data) => {
      // A response that lands after a sign-out or an account switch is stale,
      // but the flag it set still has to come down.
      if (state.uid !== uid) {
        setState({ loading: false });
        return;
      }

      setState({ credits: data.credits ?? 0, loading: false });
    })
    .catch((error) => {
      console.error('Failed to fetch credits:', error);
      setState({ loading: false });
    })
    .finally(() => {
      inFlight = null;
      inFlightUid = null;
      lastFetchedAt = Date.now();
    });

  return inFlight;
}

export function useCredits() {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [local, setLocal] = useState<CreditsState>(state);

  useEffect(() => {
    listeners.add(setLocal);
    return () => {
      listeners.delete(setLocal);
    };
  }, []);

  useEffect(() => {
    if (state.uid === uid) return;
    // Drop the previous account's balance rather than showing it to the next.
    setState({ uid, credits: null });
  }, [uid]);

  // For a caller that has just done something the server acts on. Forced,
  // because the point is to read what that action changed.
  const refresh = useCallback(async () => {
    if (!uid) return;
    await fetchCredits(uid, true);
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    void fetchCredits(uid);

    // Credits move on the server, often by the other party completing a
    // handover, so a tab that has been in the background is the most likely
    // place to be showing an out-of-date number.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchCredits(uid);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [uid]);

  return {
    credits: local.uid === uid ? (local.credits ?? 0) : 0,
    loading: local.loading,
    refresh,
  };
}
