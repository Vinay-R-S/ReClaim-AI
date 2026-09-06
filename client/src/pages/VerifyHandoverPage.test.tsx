/**
 * The verify page state machine.
 *
 * This page is the last step of a handover: the finder holds a link and a
 * six-digit code. Every one of its states was at some point unreachable or
 * wrong, so each is asserted against the server's actual vocabulary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VerifyHandoverPage from './VerifyHandoverPage';
import type { HandoverStatus, VerifyCodeResult } from '../types/domain';

const service = vi.hoisted(() => ({
  getStatus: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock('../services/handoverService', () => ({
  handoverService: {
    getStatus: service.getStatus,
    verifyCode: service.verifyCode,
    getHistory: vi.fn(),
  },
}));

/** A live session with a week left on it. */
function liveStatus(overrides: Partial<HandoverStatus> = {}): HandoverStatus {
  return {
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/verify/match-1']}>
      <Routes>
        <Route path="/verify/:matchId" element={<VerifyHandoverPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function enterCode(code: string) {
  const boxes = screen.getAllByRole('textbox');

  for (let index = 0; index < code.length; index += 1) {
    await userEvent.type(boxes[index], code[index]);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('on arrival', () => {
  it('shows the code form for a live session', async () => {
    service.getStatus.mockResolvedValue(liveStatus());

    renderPage();

    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));
  });

  /**
   * UI-06: the page tested for `completed` and `failed`, neither of which the
   * server has ever sent, so a finished handover still rendered a live form.
   */
  it('UI-06 shows the completed state for a verified session', async () => {
    service.getStatus.mockResolvedValue(liveStatus({ status: 'verified' }));

    renderPage();

    await waitFor(() => expect(screen.getByText(/already been completed/i)).toBeInTheDocument());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the blocked state for a session that ran out of attempts', async () => {
    service.getStatus.mockResolvedValue(liveStatus({ status: 'blocked', attempts: 3 }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Verification Failed/i })).toBeInTheDocument(),
    );
  });

  it('shows the expired state for a session the server has marked expired', async () => {
    service.getStatus.mockResolvedValue(liveStatus({ status: 'expired' }));

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Code expired/i })).toBeInTheDocument(),
    );
  });

  /**
   * The document is only flipped to `expired` by a verification attempt, so a
   * link opened after the deadline still reads `pending`. Without this the
   * page offered a live form for a code that cannot be accepted.
   */
  it('shows the expired state for a lapsed deadline the server has not noticed', async () => {
    service.getStatus.mockResolvedValue(
      liveStatus({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Code expired/i })).toBeInTheDocument(),
    );
  });

  /**
   * A completed handover has a long-past deadline, so the settled states have
   * to be decided before expiry or every finished handover would read expired.
   */
  it('prefers completed over expired for a finished handover', async () => {
    service.getStatus.mockResolvedValue(
      liveStatus({ status: 'verified', expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText(/already been completed/i)).toBeInTheDocument());
  });

  it('says the link is dead when there is no session behind it', async () => {
    service.getStatus.mockResolvedValue(null);

    renderPage();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Link not valid/i })).toBeInTheDocument(),
    );
  });

  it('distinguishes an unreachable server from a dead link', async () => {
    service.getStatus.mockRejectedValue(new Error('network down'));

    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Could not reach the verification service/i)).toBeInTheDocument(),
    );
  });
});

describe('submitting a code', () => {
  it('reports success and stops asking', async () => {
    service.getStatus.mockResolvedValue(liveStatus());
    service.verifyCode.mockResolvedValue({
      success: true,
      message: 'Verification successful! Item handed over.',
    } satisfies VerifyCodeResult);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('123456');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Handover Verified/i })).toBeInTheDocument(),
    );
  });

  /**
   * UI-05: the page read `attemptsRemaining`, a field no response has ever
   * carried, so the counter never moved after a wrong code.
   */
  it('UI-05 decrements the attempts counter from attemptsLeft', async () => {
    // The refetched status deliberately disagrees with the response. If the
    // page ignored `attemptsLeft` and derived the count from the status alone,
    // it would read 3 and the counter would not show at all, which is exactly
    // the defect: it read `attemptsRemaining`, a field no response carries.
    service.getStatus.mockResolvedValue(liveStatus({ attempts: 0 }));
    service.verifyCode.mockResolvedValue({
      success: false,
      message: 'Invalid code',
      attemptsLeft: 2,
    } satisfies VerifyCodeResult);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('000000');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(screen.getByText(/2 attempts remaining/i)).toBeInTheDocument());
  });

  it('says "1 attempt" rather than "1 attempts"', async () => {
    service.getStatus.mockResolvedValue(liveStatus({ attempts: 0 }));
    service.verifyCode.mockResolvedValue({
      success: false,
      message: 'Invalid code',
      attemptsLeft: 1,
    } satisfies VerifyCodeResult);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('000000');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(screen.getByText(/1 attempt remaining/i)).toBeInTheDocument());
  });

  it('leaves the form up after a wrong code so the finder can try again', async () => {
    service.getStatus
      .mockResolvedValueOnce(liveStatus())
      .mockResolvedValueOnce(liveStatus({ attempts: 1 }));
    service.verifyCode.mockResolvedValue({
      success: false,
      message: 'Invalid code',
      attemptsLeft: 2,
    } satisfies VerifyCodeResult);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('000000');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(screen.getByText(/Invalid code/i)).toBeInTheDocument());
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
  });

  it('moves to blocked when the refusal was the last attempt', async () => {
    service.getStatus
      .mockResolvedValueOnce(liveStatus())
      .mockResolvedValueOnce(liveStatus({ status: 'blocked', attempts: 3 }));
    service.verifyCode.mockResolvedValue({
      success: false,
      message: 'Too many failed attempts. Verification blocked.',
      attemptsLeft: 0,
    } satisfies VerifyCodeResult);

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('000000');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Verification Failed/i })).toBeInTheDocument(),
    );
  });

  /**
   * A rejected code is a 200 with `success: false`; anything else throws. A
   * rate limit or an outage must not be reported to the finder as a wrong
   * code.
   */
  it('shows a service failure as itself, not as a wrong code', async () => {
    service.getStatus.mockResolvedValue(liveStatus());
    service.verifyCode.mockRejectedValue(new Error('Too many attempts. Please try again later.'));

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('123456');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => expect(screen.getByText(/Too many attempts/i)).toBeInTheDocument());
  });

  it('will not submit an incomplete code', async () => {
    service.getStatus.mockResolvedValue(liveStatus());

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    await enterCode('123');

    expect(screen.getByRole('button', { name: /verify code/i })).toBeDisabled();
    expect(service.verifyCode).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a digit', async () => {
    service.getStatus.mockResolvedValue(liveStatus());

    renderPage();
    await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(6));

    const first = screen.getAllByRole('textbox')[0];
    await userEvent.type(first, 'a');

    expect(first).toHaveValue('');
  });
});
