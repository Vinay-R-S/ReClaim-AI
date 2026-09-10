/**
 * Verification, and the two-party rule it enforces.
 *
 * The gap this file exists for: the state tests pinned the *table*, which has
 * both `code_issued -> present_code -> awaiting_meet` and
 * `awaiting_meet -> confirm_receipt -> verified`. Nothing exercised the code
 * that chooses between them, and the code chose wrong — a second submission of
 * the same credential to the public verify endpoint arrived with the session
 * already at `awaiting_meet`, fell past the two-party branch, and confirmed
 * itself. One unauthenticated request sent twice defeated the whole guarantee.
 *
 * So what is tested here is the decision, not the table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp', delete: () => 'delete' },
  Timestamp: {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (date: Date) => ({ toDate: () => date }),
  },
}));

const twoParty = { value: false };

vi.mock('../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/env.js')>();

  return {
    env: {
      ...actual.env,
      handover: {
        ...actual.env.handover,
        codeSecret: 'a-test-secret-that-is-long-enough',
        attemptBackoffMs: 2_000,
        qrTtlSeconds: 120,
        get twoParty() {
          return twoParty.value;
        },
      },
    },
  };
});

const decide = vi.fn();

vi.mock('./handover/handover.machine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./handover/handover.machine.js')>();

  return {
    ...actual,
    handoverMachine: { decide: (...args: unknown[]) => decide(...args) },
  };
});

const resolveCodeRef = vi.fn(async () => ({ id: 'code-ref' }));

vi.mock('../repositories/handover.repository.js', () => ({
  HandoverRepository: class {},
  handoverRepository: {
    resolveCodeRef: (...args: unknown[]) => resolveCodeRef(...(args as [])),
    loadSessionItems: async () => ({ lostItem: null, foundItem: null }),
    writeAudit: async () => undefined,
  },
}));

vi.mock('../repositories/user.repository.js', () => ({
  UserRepository: class {},
  userRepository: { findById: async () => null, listAdminEmails: async () => [] },
}));

vi.mock('./email.service.js', () => ({
  sendHandoverCodeToLostPerson: async () => true,
  sendHandoverLinkToFoundPerson: async () => true,
  sendHandoverBlockedNotice: async () => true,
  sendHandoverCompletedNotice: async () => true,
}));

const { attemptBackoffMs, verifyHandoverCode } = await import('./handover.service.js');
const { issueQrToken } = await import('./handover/handover.qr.js');

const HOUR = 60 * 60 * 1000;

/** The stored session, as the decider sees it. */
function session(overrides: Record<string, unknown> = {}) {
  return {
    matchId: 'match-1',
    lostItemId: 'lost-1',
    foundItemId: 'found-1',
    // sha256 HMAC of '123456' is computed by the service; the tests drive the
    // match through `codeHash` by using the service's own hashing, so instead
    // they assert on which transition was chosen for a given credential.
    codeHash: 'not-the-hash',
    codeHashVersion: 2,
    attempts: 0,
    expiresAt: { toDate: () => new Date(Date.now() + HOUR) },
    ...overrides,
  };
}

interface CapturedDecision {
  kind: string;
  result: Record<string, unknown>;
  plan?: Record<string, unknown>;
}

/**
 * Drive one verification against a stored document and a state, and return
 * what the service's decider chose.
 *
 * The decider is the unit under test: it is where the two-party rule, the
 * backoff and the attempt cap are decided, and it runs inside the machine's
 * transaction. This stands in for that transaction and captures the decision
 * it was handed.
 */
async function decideFor(
  stored: Record<string, unknown> | undefined,
  from: string,
  credential = '000000',
) {
  let captured: CapturedDecision | undefined;

  decide.mockImplementation(async (_ref: unknown, _matchId: string, decider: unknown) => {
    const run = decider as (d: unknown, f: string) => Promise<CapturedDecision>;

    captured = await run(stored, from);

    return {
      result: captured.result,
      outcome:
        captured.kind === 'transition'
          ? { ok: true, from, to: 'whatever', sequence: 1 }
          : { ok: false, reason: 'refused', from },
    };
  });

  const response = await verifyHandoverCode('match-1', credential);

  return { decision: captured as CapturedDecision, response };
}

beforeEach(() => {
  vi.clearAllMocks();
  twoParty.value = false;
  resolveCodeRef.mockResolvedValue({ id: 'code-ref' });
});

describe('two-party confirmation', () => {
  it('never confirms from the verify endpoint when it is on', async () => {
    twoParty.value = true;

    // A credential that matches, presented against a session that has already
    // been presented against. Before the fix this fell through to
    // `confirm_receipt` and completed the handover.
    const token = issueQrToken('match-1').token;
    const { decision, response } = await decideFor(session(), 'awaiting_meet', token);

    expect(decision.kind).toBe('refuse');
    expect(decision.result.kind).toBe('already_presented');
    expect(response.message).toContain('already been accepted');
  });

  it('presents rather than confirms on the first submission', async () => {
    twoParty.value = true;

    const token = issueQrToken('match-1').token;
    const { decision } = await decideFor(session(), 'code_issued', token);

    expect(decision.kind).toBe('transition');
    expect(decision.plan?.transition).toBe('present_code');
    // Nothing is credited or archived until the other party confirms, so the
    // fact that starts the saga must not be published here.
    expect(decision.plan?.publish).toBeUndefined();
  });

  it('confirms directly when two-party is off, which is the flow that predates it', async () => {
    const token = issueQrToken('match-1').token;
    const { decision } = await decideFor(session(), 'code_issued', token);
    const publish = decision.plan?.publish as { name: string } | undefined;

    expect(decision.plan?.transition).toBe('confirm_receipt');
    expect(publish?.name).toBe('handover.verified');
  });

  it('does not name a party in the log, because nobody here is authenticated', async () => {
    // The credential is the owner's secret and the link is the finder's, so
    // who typed it is not known. Recording a guess in the one log a dispute is
    // resolved from would be worse than recording nothing.
    const token = issueQrToken('match-1').token;
    const { decision } = await decideFor(session(), 'code_issued', token);
    const metadata = decision.plan?.metadata as { credential?: string } | undefined;

    expect(decision.plan?.actorRole).toBe('system');
    expect(metadata?.credential).toBe('qr');
  });
});

describe('the attempt backoff', () => {
  it('doubles, so a session cannot be ground through quickly', () => {
    expect(attemptBackoffMs(0)).toBe(0);
    expect(attemptBackoffMs(1)).toBe(2_000);
    expect(attemptBackoffMs(2)).toBe(4_000);
    expect(attemptBackoffMs(3)).toBe(8_000);
  });

  it('refuses an attempt that arrives inside the wait', async () => {
    const { decision, response } = await decideFor(
      session({ attempts: 1, lastAttemptAt: { toDate: () => new Date(Date.now() - 500) } }),
      'code_issued',
    );

    expect(decision.kind).toBe('refuse');
    expect(decision.result.kind).toBe('too_soon');
    expect(response.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows one once the wait has passed', async () => {
    const { decision } = await decideFor(
      session({ attempts: 1, lastAttemptAt: { toDate: () => new Date(Date.now() - 5_000) } }),
      'code_issued',
    );

    expect(decision.kind).toBe('transition');
    expect(decision.plan?.transition).toBe('fail_attempt');
  });
});

describe('what a wrong credential does', () => {
  it('counts an attempt and reports what is left', async () => {
    const { decision, response } = await decideFor(session({ attempts: 0 }), 'code_issued');
    const patch = decision.plan?.patch as { attempts: number };

    expect(decision.plan?.transition).toBe('fail_attempt');
    expect(patch.attempts).toBe(1);
    expect(response.attemptsLeft).toBe(2);
  });

  it('blocks the session at the cap, and blocks nothing else', async () => {
    // The person typing is not necessarily the person who owns the item, which
    // is why blocking an account here was defect LOG-12.
    const { decision } = await decideFor(session({ attempts: 2 }), 'code_issued');

    expect(decision.plan?.transition).toBe('block');
    expect(decision.result.kind).toBe('now_blocked');
  });
});

describe('a session that is not live', () => {
  it('refuses without counting an attempt', async () => {
    const { decision } = await decideFor(session(), 'blocked');

    expect(decision.kind).toBe('refuse');
    expect(decision.result).toEqual({ kind: 'not_live', state: 'blocked' });
  });

  it('expires a session whose deadline has passed rather than counting the attempt', async () => {
    const { decision } = await decideFor(
      session({ expiresAt: { toDate: () => new Date(Date.now() - HOUR) } }),
      'code_issued',
    );

    expect(decision.plan?.transition).toBe('expire');
  });

  it('says so when there is no session at all', async () => {
    const { decision } = await decideFor(undefined, 'initiated');

    expect(decision.kind).toBe('refuse');
    expect(decision.result.kind).toBe('not_found');
  });
});
