/**
 * The handler registry.
 *
 * The one place a job name is bound to the code that runs it. Imported by the
 * worker at startup and by the in-process driver on first use, never by a
 * producer: a service that enqueues must not pull in every consumer.
 */

import { embedItemHandler } from './embed-item.handler.js';
import { matchItemHandler } from './match-item.handler.js';
import {
  handoverArchiveHandler,
  handoverChainHandler,
  handoverCreditsHandler,
  handoverItemsHandler,
  handoverNotifyHandler,
} from './handover-step.handler.js';
import type { JobHandlerMap } from '../queue.port.js';

export const jobHandlers: JobHandlerMap = {
  'match.item': matchItemHandler,
  'embed.item': embedItemHandler,
  'handover.items': handoverItemsHandler,
  'handover.archive': handoverArchiveHandler,
  'handover.credits': handoverCreditsHandler,
  'handover.notify': handoverNotifyHandler,
  'handover.chain': handoverChainHandler,
};
