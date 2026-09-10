import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { handoverService } from '@/services/handoverService';
import type { DisputeReason } from '@/types/domain';

const REASONS: Array<{ value: DisputeReason; label: string }> = [
  { value: 'never_received', label: 'I never received the item' },
  { value: 'wrong_item', label: 'The wrong item was handed over' },
  { value: 'item_damaged', label: 'The item was damaged' },
  { value: 'not_my_item', label: 'This is not my item' },
  { value: 'other', label: 'Something else' },
];

interface Props {
  matchId: string;
  itemName: string;
  onClose: () => void;
}

/**
 * Either party saying a completed handover is wrong.
 *
 * The window this can be raised in is a server setting, so the button is not
 * hidden once it lapses: the server refuses and says so. Guessing the deadline
 * here would mean a client that disagrees with the server the moment the
 * setting is changed, and the disagreement would show as a form that submits
 * into a refusal.
 */
export function RaiseDisputeDialog({ matchId, itemName, onClose }: Props) {
  const [reason, setReason] = useState<DisputeReason>('never_received');
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setWorking(true);
    setError(null);

    try {
      const result = await handoverService.dispute(matchId, reason, note.trim() || undefined);
      setDone(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise the dispute.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Report a problem
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <>
            <p className="text-sm text-text-primary">{done}</p>
            <p className="text-xs text-text-secondary">
              An admin reviews it. Nothing is undone until they decide, and both credit awards are
              held in the meantime.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              About the handover of <span className="font-medium">{itemName}</span>.
            </p>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="dispute-reason"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                What went wrong
              </label>
              <select
                id="dispute-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as DisputeReason)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              >
                {REASONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dispute-note"
                className="block text-xs font-medium text-text-secondary mb-1"
              >
                Anything the admin should know (optional)
              </label>
              <textarea
                id="dispute-note"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-text-secondary border border-gray-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={working}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {working ? 'Sending...' : 'Report it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
