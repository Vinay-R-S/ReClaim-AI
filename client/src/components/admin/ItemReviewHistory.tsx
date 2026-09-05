import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ShieldCheck } from 'lucide-react';
import { getItemAudit, type AdminAuditEntry, type Item } from '../../services/itemService';

interface ItemReviewHistoryProps {
  item: Item;
}

const ACTION_LABELS: Record<AdminAuditEntry['action'], string> = {
  item_approved: 'Report approved',
  item_rejected: 'Report rejected',
  match_verified: 'Match verified, handover started',
  match_rejected: 'Claim rejected, penalty applied',
};

const MODERATION_STYLES: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function formatEntryDate(entry: AdminAuditEntry): string {
  const seconds = entry.createdAt?._seconds ?? entry.createdAt?.seconds;

  if (!seconds) return '';

  return format(new Date(seconds * 1000), 'MMM d, yyyy HH:mm');
}

/**
 * Who decided what about this item, and when.
 *
 * The item document only holds the latest decision, because each one
 * overwrites the last. The trail comes from the audit collection so a
 * rejection followed by an approval still shows both.
 */
export function ItemReviewHistory({ item }: ItemReviewHistoryProps) {
  const [entries, setEntries] = useState<AdminAuditEntry[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    getItemAudit(item.id)
      .then((result) => {
        if (active) setEntries(result);
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [item.id]);

  // An item reported before review existed carries no moderation field and
  // has no trail. Showing an empty panel for it is just noise.
  const moderation = item.moderation;

  if (!moderation && entries.length === 0) return null;

  return (
    <div className="col-span-2 mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-primary">
          <ShieldCheck className="w-5 h-5 text-text-secondary" />
          <span className="font-semibold">Review history</span>
        </div>
        {moderation && (
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
              MODERATION_STYLES[moderation] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {moderation}
          </span>
        )}
      </div>

      {item.moderationReason && (
        <p className="text-sm text-text-secondary mb-3">
          <span className="font-medium text-text-primary">Reason: </span>
          {item.moderationReason}
        </p>
      )}

      {error && <p className="text-sm text-text-secondary">Could not load the review history.</p>}

      {!error && entries.length === 0 && (
        <p className="text-sm text-text-secondary">No decisions recorded yet.</p>
      )}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="bg-white border border-gray-100 rounded-lg px-3 py-2 text-sm"
          >
            <div className="flex justify-between gap-3">
              <span className="font-medium text-text-primary">{ACTION_LABELS[entry.action]}</span>
              <span className="text-xs text-text-secondary shrink-0">{formatEntryDate(entry)}</span>
            </div>
            <p className="text-xs text-text-secondary mt-0.5">By {entry.actorId}</p>
            {entry.reason && <p className="text-xs text-text-secondary mt-1">{entry.reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
