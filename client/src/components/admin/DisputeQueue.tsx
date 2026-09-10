import { useEffect, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import { isApiError } from '@/lib/api';
import { handoverService, type HandoverCompensation } from '@/services/handoverService';
import type { HandoverDispute } from '@/types/domain';

const REASONS: Record<string, string> = {
  never_received: 'Never received the item',
  wrong_item: 'The wrong item was handed over',
  item_damaged: 'The item was damaged',
  not_my_item: 'This is not my item',
  other: 'Other',
};

const STEP_LABELS: Record<string, string> = {
  'handover.items': 'Item statuses',
  'handover.archive': 'Match record',
  'handover.credits': 'Credits',
  'handover.notify': 'Correction notice',
  'handover.chain': 'Chain attestation',
};

/** The compensations a 409 carried, when it carried any. */
function compensationsIn(error: unknown): HandoverCompensation[] | null {
  if (!isApiError(error) || typeof error.body !== 'object' || error.body === null) return null;

  const { compensations } = error.body as { compensations?: unknown };

  return Array.isArray(compensations) && compensations.length > 0
    ? (compensations as HandoverCompensation[])
    : null;
}

/**
 * The open disputes, and the decision an admin makes about each.
 *
 * Both decisions are consequential and neither is reversible by the same
 * screen, so both ask for a note before the button is live: upholding runs the
 * revert, which posts reversing ledger entries and emails two people, and
 * rejecting tells somebody with a complaint that they were wrong.
 *
 * What comes back from an upheld dispute is the list of compensations that
 * ran. It is shown rather than swallowed, because a revert that stopped
 * partway is a thing somebody has to act on.
 */
export function DisputeQueue() {
  const [disputes, setDisputes] = useState<HandoverDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [result, setResult] = useState<{
    handoverId: string;
    message: string;
    compensations?: HandoverCompensation[];
  } | null>(null);

  const load = async () => {
    setLoading(true);

    try {
      setDisputes(await handoverService.getDisputes());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the dispute queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const decide = async (dispute: HandoverDispute, outcome: 'upheld' | 'rejected') => {
    const note = (notes[dispute.handoverId] ?? '').trim();

    if (note.length < 10) {
      setError('Write at least ten characters saying why. It goes into the audit trail.');
      return;
    }

    setWorking(dispute.handoverId);
    setError(null);

    try {
      const decision = await handoverService.resolveDispute(dispute.handoverId, outcome, note);

      setResult({
        handoverId: dispute.handoverId,
        message: decision.message,
        compensations: decision.compensations,
      });
      await load();
    } catch (err) {
      // A partial revert is a 409 carrying the steps that did run. Reading only
      // the message here dropped that list, which is the one thing an admin
      // needs after a revert stops halfway.
      const partial = compensationsIn(err);
      const message = err instanceof Error ? err.message : 'Could not record the decision.';

      // A partial revert did move things, so the queue is reloaded. The error
      // is set after that, because a successful `load` clears it.
      if (partial) {
        // A heading, not the server message. The banner below already carries
        // that, and showing it twice reads as two separate failures.
        setResult({
          handoverId: dispute.handoverId,
          message: 'What the revert undid before it stopped:',
          compensations: partial,
        });
        await load();
      }

      setError(message);
    } finally {
      setWorking(null);
    }
  };

  if (loading) return <p className="text-sm text-text-secondary">Loading disputes...</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
          <p className="font-semibold text-text-primary">{result.message}</p>
          {result.compensations && result.compensations.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.compensations.map((compensation) => (
                <li key={compensation.step} className="flex gap-2 text-text-secondary">
                  <span>{STEP_LABELS[compensation.step] ?? compensation.step}:</span>
                  <span>{compensation.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {disputes.length === 0 ? (
        <p className="text-sm text-text-secondary">No open disputes.</p>
      ) : (
        disputes.map((dispute) => (
          <div key={dispute.handoverId} className="border border-gray-100 rounded-xl p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-semibold text-text-primary">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  {REASONS[dispute.reason] ?? dispute.reason}
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  Raised by the {dispute.raisedByRole} on handover {dispute.handoverId}
                </p>
              </div>
            </div>

            {dispute.note && (
              <p className="mt-3 text-sm text-text-primary bg-gray-50 rounded-lg px-3 py-2">
                {dispute.note}
              </p>
            )}

            <label
              htmlFor={`note-${dispute.handoverId}`}
              className="block text-xs font-medium text-text-secondary mt-3 mb-1"
            >
              Why you are deciding this way. Both parties see it if you uphold the dispute.
            </label>
            <textarea
              id={`note-${dispute.handoverId}`}
              rows={2}
              maxLength={500}
              value={notes[dispute.handoverId] ?? ''}
              onChange={(event) =>
                setNotes((current) => ({ ...current, [dispute.handoverId]: event.target.value }))
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />

            <div className="flex flex-col sm:flex-row justify-end gap-3 mt-3">
              <button
                onClick={() => void decide(dispute, 'rejected')}
                disabled={working === dispute.handoverId}
                title="Returns the handover to completed and releases the credit hold"
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-text-secondary border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Reject the dispute
              </button>
              <button
                onClick={() => void decide(dispute, 'upheld')}
                disabled={working === dispute.handoverId}
                title="Reverts the handover: reversing credit entries, a chain revocation, and a correction notice to both parties"
                className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                {working === dispute.handoverId ? 'Working...' : 'Uphold and revert'}
              </button>
            </div>
          </div>
        ))
      )}

      <p className="flex items-start gap-1.5 text-xs text-text-secondary">
        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Reverting never deletes anything. Credits are undone by a reversing ledger entry, the chain
        attestation by a linked revocation, and the completion email by a correction notice.
      </p>
    </div>
  );
}
