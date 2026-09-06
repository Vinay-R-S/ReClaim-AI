import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { creditService } from '../../services/creditService';
import { toDate } from '../../lib/timestamps';
import type { CreditReason, CreditTransaction } from '../../types/domain';

/**
 * The entries behind the balance.
 *
 * Credits move on the server, usually because of something the other party
 * did, so a number with no explanation behind it is the whole complaint the
 * ledger endpoint was written to answer.
 */

const REASON_LABELS: Record<CreditReason, string> = {
  signup_bonus: 'Welcome bonus',
  report_found: 'Reported a found item',
  successful_match_finder: 'Your found item was claimed',
  successful_match_owner: 'Claimed your lost item',
  false_claim: 'False claim penalty',
  manual_adjustment: 'Adjusted by an admin',
};

interface CreditHistoryProps {
  userId: string;
}

export function CreditHistory({ userId }: CreditHistoryProps) {
  const [entries, setEntries] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setFailed(false);

      try {
        const history = await creditService.getHistory(userId);
        if (active) setEntries(history);
      } catch (error) {
        console.error('Failed to load credit history:', error);
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [userId]);

  const formatDate = (value: CreditTransaction['createdAt']) => {
    const parsed = toDate(value);
    if (!parsed) return '';

    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="card p-6">
      <h3 className="font-semibold text-text-primary mb-4">Credit history</h3>

      {loading ? (
        <div className="py-6 text-center text-sm text-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading...
        </div>
      ) : failed ? (
        <p className="py-6 text-center text-sm text-text-secondary">
          Could not load the history right now.
        </p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">
          Nothing yet. Credits arrive when a report of yours is reunited with its owner.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-text-primary truncate">
                  {REASON_LABELS[entry.reason] ?? entry.reason}
                </p>
                <p className="text-xs text-text-secondary">
                  {formatDate(entry.createdAt)}
                  {entry.note ? ` - ${entry.note}` : ''}
                </p>
              </div>
              <span
                className={
                  entry.amount < 0
                    ? 'text-sm font-semibold text-red-600'
                    : 'text-sm font-semibold text-green-600'
                }
              >
                {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
