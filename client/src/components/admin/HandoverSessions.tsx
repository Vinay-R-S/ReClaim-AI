import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { handoverService } from '../../services/handoverService';
import { Feedback } from '../ui/Feedback';
import { useFeedback } from '../../hooks/useFeedback';
import { cn } from '../../lib/utils';
import type { HandoverSession } from '../../types/domain';

/**
 * Handovers that have not completed.
 *
 * A session blocked by three wrong codes could not be reopened from anywhere:
 * the code is hashed so nobody can look the old one up, verification refuses a
 * blocked session outright, and the re-issue endpoint existed with no screen
 * to call it. This is that screen.
 */

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-blue-50 text-blue-700 border-blue-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Awaiting the code',
  blocked: 'Blocked',
  expired: 'Expired',
};

/**
 * The state the session is really in.
 *
 * `expired` is only written when somebody tries a code after the deadline, so
 * a session nobody ever attempted sits at `pending` with its expiry in the
 * past. Reading the stored status alone would show it as awaiting a code that
 * can no longer be accepted, and hide the button that fixes it.
 */
function effectiveStatus(session: HandoverSession): HandoverSession['status'] {
  if (session.status !== 'pending') return session.status;
  if (!session.expiresAt) return session.status;

  return new Date(session.expiresAt).getTime() < Date.now() ? 'expired' : 'pending';
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown';

  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HandoverSessions() {
  const [sessions, setSessions] = useState<HandoverSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [reissuing, setReissuing] = useState<string | null>(null);
  // Keyed by match: a session issued over an override fails the same checks
  // again, so the refusal and the justification belong to one row, not the page.
  const [criteriaFailure, setCriteriaFailure] = useState<Record<string, string>>({});
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>({});
  const { feedback, showError, showSuccess, clear } = useFeedback();

  const load = useCallback(async () => {
    setLoading(true);

    try {
      setSessions(await handoverService.getSessions());
    } catch (error) {
      console.error('Failed to load handover sessions:', error);
      showError('Could not load the open handover sessions.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const reissue = async (session: HandoverSession) => {
    const reason = (overrideReason[session.matchId] ?? '').trim();

    clear();
    setReissuing(session.matchId);

    try {
      const result = await handoverService.reissue({
        matchId: session.matchId,
        lostItemId: session.lostItemId,
        foundItemId: session.foundItemId,
        // Only once the server has already refused and the admin has written
        // down why they are proceeding anyway.
        overrideCriteria: Boolean(criteriaFailure[session.matchId]) && Boolean(reason),
        overrideReason: reason || undefined,
      });

      setCriteriaFailure((current) => {
        const next = { ...current };
        delete next[session.matchId];
        return next;
      });
      showSuccess(result.message || 'A fresh code has been emailed.');
      await load();
    } catch (error) {
      const failure = (error as { criteriaFailure?: string }).criteriaFailure;
      if (failure) {
        setCriteriaFailure((current) => ({ ...current, [session.matchId]: failure }));
      }

      showError(error instanceof Error ? error.message : 'Could not issue a new code.');
    } finally {
      setReissuing(null);
    }
  };

  // Blocked first: those are the ones somebody is waiting on.
  const ordered = [...sessions].sort((a, b) => {
    const weight = (status: string) => (status === 'blocked' ? 0 : status === 'expired' ? 1 : 2);

    return weight(effectiveStatus(a)) - weight(effectiveStatus(b));
  });

  return (
    <div className="card">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-text-primary">Open handovers</h2>
          {sessions.length > 0 && (
            <span className="text-xs text-text-secondary bg-gray-100 px-2 py-0.5 rounded-full">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {feedback && <Feedback {...feedback} onDismiss={clear} />}

        {loading ? (
          <div className="py-6 text-center text-text-secondary text-sm">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading sessions...
          </div>
        ) : ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">
            Nothing waiting. Every handover has either completed or not started.
          </p>
        ) : (
          ordered.map((session) => (
            <div
              key={session.matchId}
              className="p-3 rounded-xl border border-gray-100 bg-gray-50 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    'text-xs font-medium px-2 py-1 rounded-full border',
                    STATUS_STYLES[effectiveStatus(session)] ??
                      'bg-gray-100 text-gray-700 border-gray-200',
                  )}
                >
                  {STATUS_LABEL[effectiveStatus(session)] ?? session.status}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">
                    Match {session.matchId}
                  </p>
                  <p className="text-xs text-text-secondary flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {session.attempts} failed {session.attempts === 1 ? 'attempt' : 'attempts'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Expires {formatDate(session.expiresAt)}
                    </span>
                    {session.criteriaOverrideBy && (
                      <span className="text-amber-600">Issued on an override</span>
                    )}
                  </p>
                </div>

                {/* Not offered while a code is live: re-issuing then would
                    invalidate the one the owner is holding. */}
                {effectiveStatus(session) !== 'pending' && (
                  <button
                    onClick={() => void reissue(session)}
                    disabled={
                      reissuing === session.matchId ||
                      (Boolean(criteriaFailure[session.matchId]) &&
                        !(overrideReason[session.matchId] ?? '').trim())
                    }
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50"
                  >
                    {reissuing === session.matchId
                      ? 'Issuing...'
                      : criteriaFailure[session.matchId]
                        ? 'Override and issue'
                        : 'Issue a new code'}
                  </button>
                )}
              </div>

              {criteriaFailure[session.matchId] && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
                  <p className="text-xs text-amber-800">{criteriaFailure[session.matchId]}</p>
                  <label
                    htmlFor={`override-${session.matchId}`}
                    className="block text-xs font-medium text-amber-900"
                  >
                    Why you are issuing a code anyway
                  </label>
                  <textarea
                    id={`override-${session.matchId}`}
                    rows={2}
                    value={overrideReason[session.matchId] ?? ''}
                    onChange={(e) =>
                      setOverrideReason((current) => ({
                        ...current,
                        [session.matchId]: e.target.value,
                      }))
                    }
                    className="w-full text-xs p-2 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="Recorded in the handover audit trail."
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
