/**
 * The dispute queue's two decisions.
 *
 * Both are consequential and neither is undone by this screen, so what is
 * pinned here is the gate in front of them and what happens when a revert
 * stops halfway. The partial revert is the case that matters: it arrives as a
 * 409, and the compensations that did run are on the error rather than in a
 * success body, so reading only the message loses the list of what happened to
 * somebody's credits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DisputeQueue } from './DisputeQueue';
import { ApiError } from '@/lib/api';
import type { HandoverDispute } from '@/types/domain';

// `@/lib/api` reaches for the real Firebase config at import time, and this
// file needs `ApiError` from it. Only `auth` is used by the module under test's
// import chain, and nothing here signs in.
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  storage: {},
  googleProvider: {},
  analytics: null,
  default: {},
}));

const service = vi.hoisted(() => ({
  getDisputes: vi.fn(),
  resolveDispute: vi.fn(),
}));

vi.mock('@/services/handoverService', () => ({
  handoverService: {
    getDisputes: service.getDisputes,
    resolveDispute: service.resolveDispute,
  },
}));

function dispute(overrides: Partial<HandoverDispute> = {}): HandoverDispute {
  return {
    handoverId: 'match-1',
    reason: 'never_received',
    raisedBy: 'user-1',
    raisedByRole: 'owner',
    note: 'It never arrived',
    status: 'open',
    ...overrides,
  } as HandoverDispute;
}

async function loadQueue() {
  render(<DisputeQueue />);
  await screen.findByText('Never received the item');
}

beforeEach(() => {
  vi.resetAllMocks();
  service.getDisputes.mockResolvedValue([dispute()]);
});

describe('deciding a dispute', () => {
  it('will not send a decision without a note for the audit trail', async () => {
    await loadQueue();

    await userEvent.click(screen.getByRole('button', { name: /uphold and revert/i }));

    expect(service.resolveDispute).not.toHaveBeenCalled();
    expect(screen.getByText(/at least ten characters/i)).toBeInTheDocument();
  });

  it('sends the outcome and the note', async () => {
    service.resolveDispute.mockResolvedValue({ success: true, message: 'Handover reverted' });

    await loadQueue();

    await userEvent.type(screen.getByRole('textbox'), 'The owner produced a receipt');
    await userEvent.click(screen.getByRole('button', { name: /uphold and revert/i }));

    await waitFor(() =>
      expect(service.resolveDispute).toHaveBeenCalledWith(
        'match-1',
        'upheld',
        'The owner produced a receipt',
      ),
    );
  });

  it('shows what a partial revert managed to undo, rather than only that it failed', async () => {
    service.resolveDispute.mockRejectedValue(
      new ApiError(409, 'The revert stopped at handover.archive.', {
        error: 'The revert stopped at handover.archive.',
        compensations: [
          { step: 'handover.chain', status: 'compensated', detail: 'revocation written' },
          { step: 'handover.credits', status: 'compensated', detail: 'reversed for both parties' },
        ],
      }),
    );

    await loadQueue();

    await userEvent.type(screen.getByRole('textbox'), 'The owner produced a receipt');
    await userEvent.click(screen.getByRole('button', { name: /uphold and revert/i }));

    await screen.findByText(/revocation written/i);
    expect(screen.getByText(/reversed for both parties/i)).toBeInTheDocument();
    expect(screen.getByText(/undid before it stopped/i)).toBeInTheDocument();
    expect(screen.getByText(/stopped at handover.archive/i)).toBeInTheDocument();
  });

  it('reports a plain failure without inventing a compensation list', async () => {
    service.resolveDispute.mockRejectedValue(new ApiError(403, 'Admin access required', {}));

    await loadQueue();

    await userEvent.type(screen.getByRole('textbox'), 'The owner produced a receipt');
    await userEvent.click(screen.getByRole('button', { name: /uphold and revert/i }));

    await screen.findByText(/admin access required/i);
    expect(screen.queryByText(/Item statuses:/)).not.toBeInTheDocument();
  });
});
