/**
 * Compute and store one item's vectors.
 *
 * In the worker rather than the request, because a model load is seconds and
 * inference is milliseconds a user should not wait for. The report is saved
 * and the reporter is gone by the time this runs; nothing user-facing waits on
 * it (ADR 0004).
 */

import { embeddingService } from '../../../services/embedding.service.js';
import type { JobHandler } from '../queue.port.js';

export const embedItemHandler: JobHandler<'embed.item'> = async (payload, context) => {
  const outcome = await embeddingService.embedItem(payload.itemId);

  context.log.info('Embedding run finished', {
    itemId: payload.itemId,
    reason: payload.reason,
    outcome,
  });
};
