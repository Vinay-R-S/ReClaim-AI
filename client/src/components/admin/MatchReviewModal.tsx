import { useState } from 'react';
import { X, Package, AlertTriangle } from 'lucide-react';
import { verifyMatch } from '@/services/matchService';
import type { Item, Match } from '@/types/domain';

interface MatchReviewModalProps {
  match: Match;
  lostItem?: Item;
  foundItem?: Item;
  onClose: () => void;
  onDecided: () => void;
}

interface ScoreRow {
  label: string;
  value?: number;
}

/**
 * Side by side review of a proposed match before the admin commits to it.
 *
 * Verifying starts the handover and emails both parties their codes, and
 * rejecting an actual claim penalises the claimant, so both decisions are
 * shown with the evidence they are made from rather than as a bare button on a
 * table row.
 */
export function MatchReviewModal({
  match,
  lostItem,
  foundItem,
  onClose,
  onDecided,
}: MatchReviewModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [criteriaFailure, setCriteriaFailure] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  // Off by default. Most rows here are pipeline proposals nobody ever acted
  // on, and dismissing one of those must not charge the reporter 30 credits.
  const [penaliseClaimant, setPenaliseClaimant] = useState(false);

  // Legacy claims are recorded on the item; on everything else the person
  // answering for the pair is the reporter of the lost item.
  const claimant = foundItem?.claimedBy ?? lostItem?.claimedBy;
  const claimUserId = claimant ?? lostItem?.reportedBy;

  const scores: ScoreRow[] = [
    { label: 'Semantic', value: match.semanticScore ?? match.tagScore },
    { label: 'Colour', value: match.colorScore },
    { label: 'Location', value: match.locationScore },
    { label: 'Time', value: match.timeScore },
    { label: 'Image', value: match.imageScore },
  ];

  const decide = async (isValid: boolean) => {
    // Only the penalty needs a person. A dismissal must stay possible for a
    // proposal whose lost item has no reporter left on record, otherwise the
    // match cannot be closed at all.
    if (!isValid && penaliseClaimant && !claimUserId) {
      setError('There is nobody on record to charge, so the penalty cannot be applied.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await verifyMatch({
        itemId: match.lostItemId,
        matchId: match.id,
        claimUserId,
        isValid,
        // Only sent once the server has already refused on criteria and the
        // admin has written down why they are proceeding anyway.
        overrideCriteria: isValid && Boolean(criteriaFailure) && Boolean(overrideReason.trim()),
        overrideReason: overrideReason.trim() || undefined,
        // Only on a rejection, and only because the admin said so.
        penaliseClaimant: !isValid && penaliseClaimant,
      });
      onDecided();
    } catch (err) {
      const failure = (err as { criteriaFailure?: string }).criteriaFailure;
      if (failure) setCriteriaFailure(failure);
      setError(err instanceof Error ? err.message : 'Could not record the decision.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = (item: Item | undefined, label: string, accent: string) => (
    <div className="flex-1 border border-gray-100 rounded-xl p-4">
      <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${accent}`}>{label}</p>
      {item ? (
        <>
          {item.cloudinaryUrls?.[0] || item.imageUrl ? (
            <img
              src={item.cloudinaryUrls?.[0] || item.imageUrl}
              alt={item.name}
              className="w-full h-40 object-cover rounded-lg mb-3"
            />
          ) : (
            <div className="w-full h-40 bg-gray-50 rounded-lg mb-3 flex items-center justify-center">
              <Package className="w-8 h-8 text-gray-300" />
            </div>
          )}
          <p className="font-semibold text-text-primary">{item.name}</p>
          <p className="text-sm text-text-secondary mt-1 line-clamp-3">{item.description}</p>
          <dl className="mt-3 space-y-1 text-xs text-text-secondary">
            <div className="flex justify-between gap-2">
              <dt>Location</dt>
              <dd className="text-right text-text-primary">{item.location || '-'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Status</dt>
              <dd className="text-right text-text-primary">{item.status}</dd>
            </div>
            {item.color && (
              <div className="flex justify-between gap-2">
                <dt>Colour</dt>
                <dd className="text-right text-text-primary">{item.color}</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <p className="text-sm text-text-secondary">This item no longer exists.</p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start p-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Review match</h2>
            <p className="text-sm text-text-secondary">
              Verifying starts the handover and emails both parties a collection code.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-col sm:flex-row gap-4">
            {renderItem(lostItem, 'Lost', 'text-red-600')}
            {renderItem(foundItem, 'Found', 'text-green-600')}
          </div>

          <div className="border border-gray-100 rounded-xl p-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-sm font-semibold text-text-primary">Score breakdown</p>
              <p className="text-2xl font-bold text-primary">{match.matchScore}%</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {scores.map((score) => (
                <div key={score.label} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-text-secondary">{score.label}</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {typeof score.value === 'number' ? score.value : '-'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {criteriaFailure && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">Handover criteria not met</p>
                  <p>{criteriaFailure}</p>
                </div>
              </div>
              <label
                htmlFor="override-reason"
                className="block text-xs font-medium text-amber-900 mt-3 mb-1"
              >
                To proceed anyway, record why. This is kept in the audit trail.
              </label>
              <textarea
                id="override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
            </div>
          )}

          <label className="flex items-start gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={penaliseClaimant}
              onChange={(e) => setPenaliseClaimant(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              This was a false claim. Charge the claimant the false-claim credit penalty when
              rejecting.
            </span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-end gap-3">
            <button
              onClick={() => decide(false)}
              disabled={submitting}
              title={
                penaliseClaimant
                  ? 'Returns both items to Pending and charges the false-claim penalty'
                  : 'Returns both items to Pending. No penalty is applied'
              }
              className="px-4 py-2 text-sm font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {penaliseClaimant ? 'Reject and penalise' : 'Dismiss match'}
            </button>
            <button
              onClick={() => decide(true)}
              disabled={submitting || (Boolean(criteriaFailure) && !overrideReason.trim())}
              className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Working...' : criteriaFailure ? 'Override and verify' : 'Verify match'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
