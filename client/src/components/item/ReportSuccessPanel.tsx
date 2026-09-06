import { Sparkles } from 'lucide-react';

/**
 * What a filed report tells the reporter.
 *
 * The four states are distinct on purpose. Only `matchScore` counts as a
 * match: `bestCandidateScore` is written precisely when nothing crossed the
 * threshold, so announcing it would be the same lie the server stopped
 * telling. A report awaiting review has nothing to poll for, because matching
 * does not start until an admin approves it.
 */

/** Above this the client says the pair is worth looking at directly. */
const HIGH_CONFIDENCE = 75;

export interface MatchOutcome {
  highestScore: number;
  bestMatchId?: string;
}

interface ReportSuccessPanelProps {
  type: 'Lost' | 'Found';
  awaitingReview: boolean;
  matchPending: boolean;
  matchResult: MatchOutcome | null;
  onDismiss: () => void;
}

export function ReportSuccessPanel({
  type,
  awaitingReview,
  matchPending,
  matchResult,
  onDismiss,
}: ReportSuccessPanelProps) {
  const matched = matchResult && matchResult.highestScore > 0;

  return (
    <div className="py-8 text-center">
      <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8" />
      </div>
      <h3 className="text-2xl font-bold text-text-primary mb-2">Report Submitted!</h3>
      <p className="text-text-secondary mb-6">
        Your {type.toLowerCase()} item report has been successfully recorded.
      </p>

      {awaitingReview && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-6 text-sm text-amber-700">
          An admin will review your report shortly. We start looking for matches as soon as it is
          approved, and anything we find will appear in My Reports.
        </div>
      )}

      {!awaitingReview && matchPending && !matched && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-700">
          Checking for matches...
        </div>
      )}

      {!awaitingReview && !matchPending && !matched && (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-6 text-sm text-text-secondary">
          No match yet. We keep looking, and anything we find will appear in My Reports.
        </div>
      )}

      {matched && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-center gap-2 text-blue-700 mb-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold text-lg">AI Match Found!</span>
          </div>
          <div className="text-4xl font-bold text-blue-600 mb-2">{matchResult.highestScore}%</div>
          <p className="text-sm text-blue-600">
            Match confidence score based on your description, location, and details.
          </p>
          {matchResult.highestScore >= HIGH_CONFIDENCE && (
            <div className="mt-4 p-2 bg-white/50 rounded-lg text-xs text-blue-800 font-medium">
              High confidence match detected! You can review details in the matches section.
            </div>
          )}
        </div>
      )}

      <button
        onClick={onDismiss}
        className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-hover transition-colors shadow-md"
      >
        Got it
      </button>
    </div>
  );
}
