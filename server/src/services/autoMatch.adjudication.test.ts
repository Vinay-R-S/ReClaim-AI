/**
 * What automatic matching does with an adjudication verdict.
 *
 * The finding this file exists for: the trace used to be attached to whichever
 * pair happened to sit at `matches[0]`, and the adjudicated pair is often not
 * that one — a discard removes it, and a pair that failed the evidence guards
 * was never in the list at all. Both wrote one pair's reasoning onto another
 * pair's record, where an admin reads it as the justification for approving a
 * handover.
 *
 * The other half is the handover gate. Everything here decides whether two
 * people receive a collection code, which is the one step in the system that
 * cannot be taken back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({}) }),
  default: {},
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts', delete: () => 'delete' },
}));

const run = vi.fn();

vi.mock('./matching/matching.pipeline.js', () => ({
  MatchingService: class {
    run(...args: unknown[]) {
      return run(...args);
    }
  },
}));

const initiateHandover = vi.fn(async () => ({ success: true }));

vi.mock('./handover.service.js', () => ({
  initiateHandover: (...args: unknown[]) => initiateHandover(...args),
}));

const itemPatch = vi.fn(async () => undefined);
const itemUpdate = vi.fn(async () => undefined);

vi.mock('../repositories/item.repository.js', () => ({
  ItemRepository: class {},
  itemRepository: {
    patch: (...args: unknown[]) => itemPatch(...args),
    update: (...args: unknown[]) => itemUpdate(...args),
  },
}));

const matchCreate = vi.fn(async () => 'match-new');
const matchUpdate = vi.fn(async () => undefined);
const findByPair = vi.fn(async () => null);

vi.mock('../repositories/match.repository.js', () => ({
  MatchRepository: class {},
  matchRepository: {
    create: (...args: unknown[]) => matchCreate(...args),
    update: (...args: unknown[]) => matchUpdate(...args),
    findByPair: (...args: unknown[]) => findByPair(...args),
  },
}));

const { triggerAutoMatching } = await import('./autoMatch.service.js');

const INPUT = {
  name: 'Black leather wallet',
  description: 'Black bifold wallet',
  tags: ['wallet'],
  location: 'Central library',
  date: new Date('2026-09-08T09:00:00Z'),
  reportedBy: 'owner-1',
};

function scored(id: string, score: number) {
  return {
    item: { id, name: 'Wallet', type: 'Found' },
    score,
    rawScore: score,
    applicableWeight: 85,
    preScore: 0.5,
    breakdown: {
      semantic: { score: 35, weight: 50, applicable: true },
      color: { score: 10, weight: 10, applicable: true },
      location: { score: 8, weight: 15, applicable: true },
      time: { score: 7, weight: 10, applicable: true },
      image: { score: 0, weight: 15, applicable: false },
    },
  };
}

function trace(lostItemId: string, foundItemId: string, decision = 'no_match') {
  return {
    verdict: { decision, confidence: 95, evidence: ['12 km apart'], contradictions: [] },
    lostItemId,
    foundItemId,
    pipelineScore: 71,
    steps: [{ tool: 'geo_distance', args: {}, result: 'distance: 12.00 km', ms: 3 }],
    toolCalls: 1,
    modelCalls: 2,
    stoppedBy: 'verdict',
    promptVersion: 'adjudicate/v1',
    model: 'test-model',
    provider: 'test',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.0004,
    ms: 900,
    mode: 'on',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findByPair.mockResolvedValue(null);
  matchCreate.mockResolvedValue('match-new');
});

describe('attaching the trace', () => {
  it('puts it on the pair the agent judged, not the first in the list', async () => {
    // The discard case: the agent rejected found-1, the pipeline removed it,
    // and found-2 is now first. found-2 was never adjudicated.
    run.mockResolvedValue({
      matches: [scored('found-2', 66)],
      best: scored('found-1', 71),
      evaluated: 2,
      adjudication: trace('lost-1', 'found-1'),
      adjudicationOutcome: 'discard',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(matchCreate).toHaveBeenCalledTimes(1);

    const written = matchCreate.mock.calls[0][0] as Record<string, unknown>;

    expect(written.foundItemId).toBe('found-2');
    expect(written.adjudication).toBeUndefined();
  });

  it('attaches it when the record being written is the adjudicated pair', async () => {
    run.mockResolvedValue({
      matches: [scored('found-1', 71)],
      best: scored('found-1', 71),
      evaluated: 1,
      adjudication: trace('lost-1', 'found-1', 'match'),
      adjudicationOutcome: 'confirm',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    const written = matchCreate.mock.calls[0][0] as {
      adjudication?: { decision: string; evidence: string[] };
    };

    expect(written.adjudication?.decision).toBe('match');
    expect(written.adjudication?.evidence).toEqual(['12 km apart']);
  });

  it('patches a pair that already has a record, rather than throwing the verdict away', async () => {
    findByPair.mockResolvedValueOnce({ id: 'match-existing' });

    run.mockResolvedValue({
      matches: [scored('found-1', 71)],
      best: scored('found-1', 71),
      evaluated: 1,
      adjudication: trace('lost-1', 'found-1', 'needs_human_review'),
      adjudicationOutcome: 'human_review',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(matchCreate).not.toHaveBeenCalled();
    expect(matchUpdate).toHaveBeenCalledWith(
      'match-existing',
      expect.objectContaining({ handoverHeld: true }),
    );
  });
});

describe('the handover gate', () => {
  it('starts the handover when the agent confirmed the pair', async () => {
    run.mockResolvedValue({
      matches: [scored('found-1', 71)],
      best: scored('found-1', 71),
      evaluated: 1,
      adjudication: trace('lost-1', 'found-1', 'match'),
      adjudicationOutcome: 'confirm',
    });

    const result = await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(initiateHandover).toHaveBeenCalledTimes(1);
    expect(result?.awaitingReview).toBe(false);
  });

  it('holds the handover when the agent could not decide', async () => {
    run.mockResolvedValue({
      matches: [scored('found-1', 71)],
      best: scored('found-1', 71),
      evaluated: 1,
      adjudication: trace('lost-1', 'found-1', 'needs_human_review'),
      adjudicationOutcome: 'human_review',
    });

    const result = await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(initiateHandover).not.toHaveBeenCalled();
    expect(result?.awaitingReview).toBe(true);

    const written = matchCreate.mock.calls[0][0] as Record<string, unknown>;

    // The record is still written, because the admin's review is the point.
    expect(written.handoverHeld).toBe(true);
  });

  it('holds it after a discard, because the runner-up was never adjudicated', async () => {
    run.mockResolvedValue({
      matches: [scored('found-2', 66)],
      best: scored('found-1', 71),
      evaluated: 2,
      adjudication: trace('lost-1', 'found-1'),
      adjudicationOutcome: 'discard',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(initiateHandover).not.toHaveBeenCalled();
  });
});

describe('the near-miss score written back to the item', () => {
  it('is not written from a pair the agent has just rejected', async () => {
    run.mockResolvedValue({
      matches: [],
      best: scored('found-1', 71),
      evaluated: 1,
      adjudication: trace('lost-1', 'found-1'),
      adjudicationOutcome: 'discard',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(itemPatch).not.toHaveBeenCalled();
  });

  it('is still written for an ordinary near miss', async () => {
    run.mockResolvedValue({
      matches: [],
      best: scored('found-1', 48),
      evaluated: 1,
      adjudication: null,
      adjudicationOutcome: 'unchanged',
    });

    await triggerAutoMatching('lost-1', 'Lost', INPUT);

    expect(itemPatch).toHaveBeenCalledWith('lost-1', { bestCandidateScore: 48 });
  });
});
