/**
 * Who is allowed to dispute a handover.
 *
 * The role is resolved from the handover, never read from the body, because a
 * dispute freezes both credit awards and reopens a settled record. Trusting a
 * claimed role would let anybody with a match id do that to two strangers.
 *
 * The four cases are the whole gate: the owner, the finder, an admin acting on
 * somebody's behalf, and everybody else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/firebase-admin.js', () => ({
  db: { collection: () => ({}), runTransaction: async () => undefined },
  auth: {},
  collections: new Proxy({}, { get: () => ({ doc: () => ({}) }) }),
  default: {},
}));

const raiseDispute = vi.fn();

vi.mock('../services/handover/handover.revert.js', () => ({
  handoverRevertService: {
    raiseDispute: (...args: unknown[]) => raiseDispute(...(args as [])),
  },
}));

vi.mock('../services/handover.service.js', () => ({
  confirmHandoverReceipt: vi.fn(),
  getHandoverHistory: vi.fn(),
  getHandoverStatus: vi.fn(),
  initiateHandover: vi.fn(),
  issueHandoverQr: vi.fn(),
  verifyHandoverCode: vi.fn(),
}));

const { HandoverController } = await import('./handover.controller.js');
const { AppError } = await import('../middleware/errorHandler.middleware.js');

const OWNER = 'owner-1';
const FINDER = 'finder-1';

function build(options: { session?: Record<string, string> | null } = {}) {
  const session =
    options.session === undefined
      ? { lostItemId: 'lost-1', foundItemId: 'found-1' }
      : options.session;

  const handovers = {
    findSessionByMatch: async () => session,
    ownerOf: async (itemId: string) => (itemId === 'lost-1' ? OWNER : FINDER),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HandoverController(handovers as any);
}

function request(uid: string | undefined, role?: string) {
  return {
    body: { matchId: 'match-1', reason: 'never_received', note: 'It never arrived' },
    user: uid ? { uid, role } : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const response = {
  json: (body: unknown) => body,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  raiseDispute.mockResolvedValue({ success: true, message: 'Dispute raised' });
});

describe('raising a dispute', () => {
  it('lets the owner of the lost item dispute, as the owner', async () => {
    await build().dispute(request(OWNER), response);

    expect(raiseDispute).toHaveBeenCalledWith(
      'match-1',
      OWNER,
      'owner',
      'never_received',
      'It never arrived',
    );
  });

  it('lets the reporter of the found item dispute, as the finder', async () => {
    await build().dispute(request(FINDER), response);

    expect(raiseDispute).toHaveBeenCalledWith(
      'match-1',
      FINDER,
      'finder',
      'never_received',
      'It never arrived',
    );
  });

  it('refuses somebody who is neither party', async () => {
    await expect(build().dispute(request('stranger-1'), response)).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(raiseDispute).not.toHaveBeenCalled();
  });

  it('lets an admin raise one on a party\'s behalf, recorded as the admin', async () => {
    await build().dispute(request('admin-1', 'admin'), response);

    expect(raiseDispute).toHaveBeenCalledWith(
      'match-1',
      'admin-1',
      'admin',
      'never_received',
      'It never arrived',
    );
  });

  it('does not trust a role sent in the body', async () => {
    // The body is validated against a schema that has no role field, but the
    // point is that the party is derived from the handover: a request from the
    // finder is recorded as the finder whatever it claims to be.
    const req = request(FINDER);
    req.body.party = 'admin';

    await build().dispute(req, response);

    expect(raiseDispute).toHaveBeenCalledWith(
      'match-1',
      FINDER,
      'finder',
      'never_received',
      'It never arrived',
    );
  });

  it('answers 404 for a handover that does not exist', async () => {
    await expect(
      build({ session: null }).dispute(request(OWNER), response),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses an unauthenticated caller before it reads anything', async () => {
    await expect(build().dispute(request(undefined), response)).rejects.toBeInstanceOf(AppError);
    expect(raiseDispute).not.toHaveBeenCalled();
  });
});
