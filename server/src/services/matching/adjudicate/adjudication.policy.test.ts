/**
 * The rules that hold whatever the model said.
 *
 * This is the file worth the most tests in the phase. The agent is one call to
 * a third party and its answer is a suggestion; this is the code that turns a
 * suggestion into two people receiving an email, so every path through it is
 * pinned here rather than reasoned about.
 */

import { describe, expect, it } from 'vitest';
import { applyVerdict, blocksAutoHandover } from './adjudication.policy.js';
import type { AdjudicationDecision, AdjudicationTrace } from './adjudication.types.js';

function traceWith(decision: AdjudicationDecision, confidence: number): AdjudicationTrace {
  return {
    verdict: { decision, confidence, evidence: [], contradictions: [] },
    lostItemId: 'lost-1',
    foundItemId: 'found-1',
    pipelineScore: 70,
    steps: [],
    toolCalls: 2,
    modelCalls: 3,
    stoppedBy: 'verdict',
    promptVersion: 'adjudicate/v1',
    model: 'test-model',
    provider: 'test',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    ms: 1200,
    mode: 'on',
  };
}

const on = { minConfidence: 70, mode: 'on' as const, aboveThreshold: true };

describe('applyVerdict', () => {
  describe('shadow mode', () => {
    it('changes nothing, whatever the verdict says', () => {
      const decisions: AdjudicationDecision[] = ['match', 'no_match', 'needs_human_review'];

      decisions.forEach((decision) => {
        const outcome = applyVerdict(traceWith(decision, 100), {
          wasMatch: true,
          eligible: true,
          aboveThreshold: true,
          minConfidence: 70,
          mode: 'shadow',
        });

        expect(outcome).toBe('unchanged');
      });
    });
  });

  describe('confidence floor', () => {
    it('sends a match the agent is unsure about to a person rather than acting on it', () => {
      expect(
        applyVerdict(traceWith('no_match', 40), { wasMatch: true, eligible: true, ...on }),
      ).toBe('human_review');
    });

    it('leaves a non-match alone when the agent is unsure', () => {
      expect(
        applyVerdict(traceWith('match', 40), { wasMatch: false, eligible: true, ...on }),
      ).toBe('unchanged');
    });

    it('acts exactly at the floor, not above it', () => {
      expect(
        applyVerdict(traceWith('no_match', 70), { wasMatch: true, eligible: true, ...on }),
      ).toBe('discard');
    });
  });

  describe('no_match', () => {
    it('discards a pair the pipeline had as a match', () => {
      expect(
        applyVerdict(traceWith('no_match', 90), { wasMatch: true, eligible: true, ...on }),
      ).toBe('discard');
    });

    it('does nothing to a pair that was not a match anyway', () => {
      expect(
        applyVerdict(traceWith('no_match', 90), { wasMatch: false, eligible: true, ...on }),
      ).toBe('unchanged');
    });
  });

  describe('match', () => {
    it('confirms an eligible pair', () => {
      expect(
        applyVerdict(traceWith('match', 90), { wasMatch: false, eligible: true, ...on }),
      ).toBe('confirm');
    });

    it('never confirms a pair the deterministic guards refused', () => {
      expect(
        applyVerdict(traceWith('match', 100), { wasMatch: false, eligible: false, ...on }),
      ).toBe('unchanged');
    });

    it('never puts a sub-threshold pair on the automatic path', () => {
      // The agent may argue for a pair the deterministic scorer refused; the
      // argument goes to a person, because confirming here emails two
      // strangers a collection code.
      expect(
        applyVerdict(traceWith('match', 100), {
          wasMatch: false,
          eligible: true,
          minConfidence: 70,
          mode: 'on',
          aboveThreshold: false,
        }),
      ).toBe('human_review');
    });

    it('sends an ineligible pair that was already a match to a person', () => {
      // It was a match on the deterministic path and the evidence behind it is
      // now in question, so it stops being automatic without being thrown away.
      expect(
        applyVerdict(traceWith('match', 100), { wasMatch: true, eligible: false, ...on }),
      ).toBe('human_review');
    });
  });

  describe('needs_human_review', () => {
    it('holds a match for a person', () => {
      expect(
        applyVerdict(traceWith('needs_human_review', 95), {
          wasMatch: true,
          eligible: true,
          ...on,
        }),
      ).toBe('human_review');
    });

    it('does not promote a non-match into a review queue', () => {
      expect(
        applyVerdict(traceWith('needs_human_review', 95), {
          wasMatch: false,
          eligible: true,
          ...on,
        }),
      ).toBe('unchanged');
    });
  });
});

describe('blocksAutoHandover', () => {
  it('blocks a pair held for review', () => {
    expect(blocksAutoHandover('human_review')).toBe(true);
  });

  it('blocks after a discard, because the runner-up was never adjudicated', () => {
    // Removing the winner promotes a pair no agent looked at and which scored
    // lower than the one just rejected. Handing that to an automatic handover
    // is worse than not having run the agent at all.
    expect(blocksAutoHandover('discard')).toBe(true);
  });

  it('leaves the automatic path alone otherwise', () => {
    expect(blocksAutoHandover('confirm')).toBe(false);
    expect(blocksAutoHandover('unchanged')).toBe(false);
  });
});
