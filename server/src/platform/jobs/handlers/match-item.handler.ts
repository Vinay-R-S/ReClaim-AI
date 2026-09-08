/**
 * Run the matching pipeline for one item.
 *
 * The work itself is unchanged and still lives in the item service; what
 * changed is that it is now a durable job with a retry policy instead of a
 * detached promise that a deploy could drop.
 */

import { itemService } from '../../../services/item.service.js';
import type { JobHandler } from '../queue.port.js';

export const matchItemHandler: JobHandler<'match.item'> = async (payload, context) => {
  context.log.info('Matching run starting', { itemId: payload.itemId, reason: payload.reason });

  await itemService.runMatching(payload.itemId);
};
