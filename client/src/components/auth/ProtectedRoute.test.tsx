/**
 * The auth guards.
 *
 * These decide who reaches a screen, so each rule is tested for what it lets
 * through as well as what it turns away. Two are named after the defect they
 * close.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';

type AuthState = {
  user: { uid: string } | null;
  role: 'user' | 'admin' | null;
  userStatus: 'active' | 'blocked' | null;
  loading: boolean;
};

const authState = vi.hoisted(() => ({
  current: {
    user: { uid: 'user-1' },
    role: 'user',
    userStatus: 'active',
    loading: false,
  } as AuthState,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => authState.current,
}));

/**
 * Each guard is mounted on a path that is not one of its own redirect
 * targets. `AdminRoute` sends a non-admin to `/app`, so mounting it there
 * would be an infinite redirect rather than a test.
 */
function renderAt(path: string, guard: 'user' | 'admin' = 'user') {
  const Guard = guard === 'user' ? ProtectedRoute : AdminRoute;
  const guardedPath = guard === 'user' ? '/app/*' : '/admin/*';

  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<div>sign in</div>} />
        {guard === 'user' && <Route path="/admin" element={<div>admin dashboard</div>} />}
        {guard === 'admin' && <Route path="/app" element={<div>user home</div>} />}
        <Route
          path={guardedPath}
          element={
            <Guard>
              <div>protected content</div>
            </Guard>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function signedIn(overrides: Partial<AuthState> = {}) {
  authState.current = {
    user: { uid: 'user-1' },
    role: 'user',
    userStatus: 'active',
    loading: false,
    ...overrides,
  };
}

describe('ProtectedRoute', () => {
  it('renders the screen for a signed-in active user', () => {
    signedIn();

    renderAt('/app');

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('waits rather than redirecting while auth is still resolving', () => {
    signedIn({ user: null, loading: true });

    renderAt('/app');

    expect(screen.queryByText('sign in')).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('sends a signed-out visitor to the sign-in page', () => {
    signedIn({ user: null, role: null, userStatus: null });

    renderAt('/app');

    expect(screen.getByText('sign in')).toBeInTheDocument();
  });

  it('turns a blocked account away even though it holds a session', () => {
    signedIn({ userStatus: 'blocked' });

    renderAt('/app');

    expect(screen.getByText('sign in')).toBeInTheDocument();
  });

  /**
   * UI-12: an admin is also a reporter, with handovers, reports and a profile
   * of their own. The guard used to bounce them off every `/app` route.
   */
  it('UI-12 lets an admin open their own reports', () => {
    signedIn({ role: 'admin' });

    renderAt('/app/reports');

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('sends an admin landing on the bare /app to their own dashboard', () => {
    signedIn({ role: 'admin' });

    renderAt('/app');

    expect(screen.getByText('admin dashboard')).toBeInTheDocument();
  });

  it('does the same for /app with a trailing slash', () => {
    signedIn({ role: 'admin' });

    renderAt('/app/');

    expect(screen.getByText('admin dashboard')).toBeInTheDocument();
  });
});

describe('AdminRoute', () => {
  it('renders the screen for an admin', () => {
    signedIn({ role: 'admin' });

    renderAt('/admin', 'admin');

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('turns an ordinary user away, back to their own side of the app', () => {
    signedIn({ role: 'user' });

    renderAt('/admin', 'admin');

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByText('user home')).toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in rather than to the app', () => {
    signedIn({ user: null, role: null });

    renderAt('/admin', 'admin');

    expect(screen.getByText('sign in')).toBeInTheDocument();
  });

  /**
   * An unresolved role is not an admin. Rendering the admin screen while the
   * profile read is still in flight would flash it to everyone.
   */
  it('waits while the role is still unknown', () => {
    signedIn({ role: null, loading: true });

    renderAt('/admin', 'admin');

    // Absent alone would also be true of a guard that dropped its loading
    // check and redirected a still-resolving admin away.
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.queryByText('user home')).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
