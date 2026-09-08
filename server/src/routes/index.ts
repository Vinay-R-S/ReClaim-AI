/**
 * The API route table.
 *
 * A declaration rather than a sequence of `app.use` calls, because two things
 * need to read it: `app.ts`, which mounts it, and the contract test, which
 * compares it against `docs/api/openapi.json`. A route that exists in one and
 * not the other is how a client and a server drift apart (defect ARCH-19).
 */

import type { Router } from 'express';
import itemsRoutes from './items.js';
import matchesRoutes from './matches.js';
import settingsRoutes from './settings.js';
import handoverRoutes from './handover.js';
import creditsRoutes from './credits.js';
import authRoutes from './auth.js';
import cctvRoutes from './cctv.js';
import aiRoutes from './ai.js';
import usersRoutes from './users.js';
import statsRoutes from './stats.js';

export interface RouteMount {
  prefix: string;
  router: Router;
  /**
   * A second mount of a router already listed above. It answers identically
   * and is not documented separately.
   */
  alias?: boolean;
}

export const routeTable: RouteMount[] = [
  { prefix: '/items', router: itemsRoutes },
  { prefix: '/matches', router: matchesRoutes },
  { prefix: '/settings', router: settingsRoutes },
  { prefix: '/handover', router: handoverRoutes },
  // One router, two mount points. `/handovers/user/:userId` and
  // `/handover/verify` were separate files with no rule about which endpoint
  // lived where; both paths are kept so no client call changes.
  { prefix: '/handovers', router: handoverRoutes, alias: true },
  { prefix: '/credits', router: creditsRoutes },
  { prefix: '/auth', router: authRoutes },
  { prefix: '/cctv', router: cctvRoutes },
  { prefix: '/ai', router: aiRoutes },
  { prefix: '/users', router: usersRoutes },
  { prefix: '/stats', router: statsRoutes },
];
