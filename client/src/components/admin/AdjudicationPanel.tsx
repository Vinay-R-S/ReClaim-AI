import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, HelpCircle, Wrench, X } from 'lucide-react';
import type { AdjudicationRecord } from '@/types/domain';

interface AdjudicationPanelProps {
  adjudication: AdjudicationRecord;
  /** True when the agent stopped the automatic handover and left this here. */
  handoverHeld?: boolean;
}

const DECISIONS = {
  match: {
    label: 'Same object',
    tone: 'text-green-700 bg-green-50 border-green-200',
    Icon: Check,
  },
  no_match: {
    label: 'Not the same object',
    tone: 'text-red-700 bg-red-50 border-red-200',
    Icon: X,
  },
  needs_human_review: {
    label: 'Could not decide',
    tone: 'text-amber-800 bg-amber-50 border-amber-200',
    Icon: HelpCircle,
  },
} as const;

const STOPPED = {
  verdict: 'reached a verdict',
  tool_budget: 'ran out of tool calls',
  deadline: 'ran out of time',
} as const;

/**
 * What the adjudication agent concluded, and what it looked at.
 *
 * The point of showing it is that an admin verifying a match is being asked to
 * trust a number. A score of 71 says nothing about why; "the photographs score
 * 0.31 against each other and the reports are 12 km apart" is a reason, and it
 * is checkable against the two reports on the same screen.
 *
 * Every string here is model-written text derived from what two members of the
 * public typed, so it is rendered as text through JSX and never as markup, and
 * the shadow-mode banner exists so nobody reads a recommendation as a decision
 * the system acted on.
 */
export function AdjudicationPanel({ adjudication, handoverHeld }: AdjudicationPanelProps) {
  const [showTrace, setShowTrace] = useState(false);

  const decision = DECISIONS[adjudication.decision] ?? DECISIONS.needs_human_review;
  const { Icon } = decision;

  return (
    <div className="border border-gray-100 rounded-xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-text-primary">Agent review</p>
        <p className="text-xs text-text-secondary">
          {adjudication.toolCalls} check{adjudication.toolCalls === 1 ? '' : 's'},{' '}
          {STOPPED[adjudication.stoppedBy] ?? 'stopped'}
        </p>
      </div>

      <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${decision.tone}`}>
        <Icon className="w-4 h-4 shrink-0" />
        <p className="text-sm font-semibold">{decision.label}</p>
        <p className="text-xs ml-auto">{adjudication.confidence}% confident</p>
      </div>

      {adjudication.mode === 'shadow' && (
        <p className="text-xs text-text-secondary mt-2">
          Recorded for comparison only. This verdict changed nothing about the match.
        </p>
      )}

      {handoverHeld && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          The handover was not started automatically. Verifying below is what sends both
          parties their collection codes.
        </p>
      )}

      {adjudication.evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Evidence for
          </p>
          <ul className="space-y-1">
            {adjudication.evidence.map((line) => (
              <li key={line} className="text-sm text-text-primary flex gap-2">
                <span className="text-green-600">+</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adjudication.contradictions.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Evidence against
          </p>
          <ul className="space-y-1">
            {adjudication.contradictions.map((line) => (
              <li key={line} className="text-sm text-text-primary flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adjudication.steps.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowTrace((open) => !open)}
            aria-expanded={showTrace}
            className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showTrace ? 'rotate-180' : ''}`}
            />
            {showTrace ? 'Hide' : 'Show'} what it checked
          </button>

          {showTrace && (
            <ol className="mt-2 space-y-2">
              {adjudication.steps.map((step, index) => (
                <li
                  key={`${step.tool}-${index}`}
                  className="bg-gray-50 rounded-lg px-3 py-2 text-xs"
                >
                  <p className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <Wrench className="w-3 h-3 shrink-0" />
                    {step.tool}
                    {step.failed && <span className="text-amber-700">(refused)</span>}
                  </p>
                  <p className="text-text-secondary whitespace-pre-wrap mt-1">{step.result}</p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <p className="text-[11px] text-text-secondary mt-3">
        {adjudication.model} via {adjudication.provider}, prompt {adjudication.promptVersion}
      </p>
    </div>
  );
}
