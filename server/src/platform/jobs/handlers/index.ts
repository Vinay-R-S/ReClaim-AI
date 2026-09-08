/**
 * The handler registry.
 *
 * The one place a job name is bound to the code that runs it. Imported by the
 * worker at startup and by the in-process driver on first use, never by a
 * producer: a service that enqueues must not pull in every consumer.
 */

import { matchItemHandler } from './match-item.handler.js';
import type { JobHandlerMap } from '../queue.port.js';

export const jobHandlers: JobHandlerMap = {
  'match.item': matchItemHandler,
};
