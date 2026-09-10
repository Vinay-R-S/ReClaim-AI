/**
 * The batched reranker.
 *
 * One schema-constrained call scores every candidate. What the model returns
 * is validated against the ids it was given before any of it is believed:
 * section 8.8 says never accept free text as a decision, and an id the prompt
 * did not contain is exactly that — a decision about something nobody asked
 * about.
 */

import { z } from 'zod';
import { aiRouter, defineStructured } from '../../../platform/ai/index.js';
import { createLogger } from '../../../utils/logger.js';
import { env } from '../../../config/env.js';
import { chunk, withTimeout } from '../../../utils/async.js';
import {
  buildRerankPrompt,
  flagInjection,
  newFence,
  PROMPT_VERSION,
  systemPrompt,
  type PromptCandidate,
} from './rerank.prompt.js';
import type { Reranker, RerankResult, RerankedCandidate } from './rerank.types.js';
import type { Item } from '../../../types/index.js';
import type { MatchSubject } from '../matching.types.js';

const log = createLogger('matching:rerank');

/**
 * Wall clock for the whole rerank, across every batch.
 *
 * Enforced by cutting a batch off at whatever is left of it, not by checking
 * the clock between batches. Checking between batches bounds nothing: a batch
 * that starts one millisecond inside the budget runs to its own ceiling, and
 * that ceiling is larger than it looks — `chatStructured` makes two router
 * calls, the original and the repair, each with its own fresh deadline. Two
 * batches of that is minutes, inside a `match.item` attempt killed at two
 * minutes and shared with adjudication.
 *
 * Reaching the budget is not a failure. The batches that answered are kept,
 * and a candidate with no verdict is a candidate rather than a match.
 */
const TOTAL_BUDGET_MS = 60_000;

const VERDICTS = ['same', 'likely', 'unlikely', 'different'] as const;

/**
 * The shape the model must answer in.
 *
 * `score` is an integer 0-100 and `verdict` an enum member, both enforced
 * here, which is what replaces reading a number out of prose. A reply that
 * does not fit is repaired once by the router and then fails, rather than
 * being coerced into a number that looks plausible.
 */
const RERANK_SCHEMA = defineStructured({
  name: 'rerank_verdicts',
  schema: z.object({
    verdicts: z.array(
      z.object({
        id: z.string(),
        score: z.number().int().min(0).max(100),
        verdict: z.enum(VERDICTS),
        reason: z.string().max(200).optional(),
      }),
    ),
  }),
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'score', 'verdict', 'reason'],
          properties: {
            id: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            verdict: { type: 'string', enum: [...VERDICTS] },
            // Capped on both sides. The zod schema rejects a longer reason and
            // the provider is told not to produce one, so the two validators
            // cannot disagree about what is acceptable.
            reason: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
  },
});

export class LlmReranker implements Reranker {
  async rerank(subject: MatchSubject, candidates: Item[]): Promise<RerankResult | null> {
    if (candidates.length === 0) return null;

    const started = Date.now();
    const prompted: PromptCandidate[] = candidates
      .filter((item) => typeof item.id === 'string')
      .map((item) => ({ id: item.id as string, item }));

    prompted.forEach(({ id, item }) => flagInjection(id, item));

    const scores = new Map<string, RerankedCandidate>();
    // Every model that answered, not the last one: with a fallback list a
    // batch can be answered by a different provider than its neighbour, and
    // attributing all the verdicts to whichever finished last would make a
    // stored score explainable only by accident.
    const models = new Set<string>();

    // Batched, but not unboundedly: a hundred candidates in one prompt is a
    // context the model reasons about worse and a single failure that costs
    // every candidate at once.
    const batches = chunk(prompted, env.matching.rerankBatchSize);
    const deadline = started + TOTAL_BUDGET_MS;

    for (const batch of batches) {
      const remaining = deadline - Date.now();

      if (remaining <= 0) {
        log.warn('Rerank ran out of time; the remaining candidates were not scored', {
          scored: scores.size,
          of: prompted.length,
        });

        break;
      }

      // The batch is cut off at what is left, so the budget is a bound on this
      // loop rather than a suggestion checked between iterations.
      const result = await withTimeout(
        this.scoreBatch(subject, batch),
        remaining,
        'rerank batch',
      ).catch((error: unknown) => {
        log.warn('Rerank batch exceeded the remaining budget', { error });

        return null;
      });

      if (!result) continue;

      models.add(result.model);
      result.verdicts.forEach((verdict) => scores.set(verdict.id, verdict));
    }

    if (scores.size === 0) {
      log.warn('Rerank produced nothing usable', { candidates: prompted.length });

      return null;
    }

    return {
      scores,
      model: [...models].sort().join(','),
      requested: prompted.length,
      ms: Date.now() - started,
    };
  }

  private async scoreBatch(
    subject: MatchSubject,
    batch: PromptCandidate[],
  ): Promise<{ verdicts: RerankedCandidate[]; model: string } | null> {
    const allowed = new Set(batch.map((entry) => entry.id));
    // One delimiter per call, so untrusted text cannot close a fence it has
    // never seen. See the header of rerank.prompt.ts.
    const fence = newFence();

    try {
      const { value, response } = await aiRouter.chatStructured(
        'match.rerank',
        {
          messages: [
            { role: 'system', content: systemPrompt(fence) },
            { role: 'user', content: buildRerankPrompt(subject, batch, fence) },
          ],
        },
        RERANK_SCHEMA,
      );

      const answered = new Set<string>();

      const verdicts = value.verdicts.filter((verdict) => {
        // A repeated id would be counted twice, which drives `missing` below
        // zero and silences the log that says candidates went unanswered.
        if (answered.has(verdict.id)) return false;

        answered.add(verdict.id);

        // An id the prompt did not contain is either a hallucination or an
        // attempt to score a report that was not in this batch. Neither is a
        // verdict about anything, so it is dropped rather than stored.
        if (allowed.has(verdict.id)) return true;

        log.warn('Rerank answered for a candidate it was not given', {
          promptVersion: PROMPT_VERSION,
        });

        return false;
      });

      const missing = allowed.size - verdicts.length;

      if (missing > 0) {
        // Not an error: a candidate with no verdict simply keeps whatever the
        // rest of the pipeline can say about it.
        log.debug('Rerank did not answer for every candidate', { missing, of: allowed.size });
      }

      log.info('Rerank batch', {
        candidates: batch.length,
        answered: verdicts.length,
        provider: response.providerId,
        model: response.model,
        promptVersion: PROMPT_VERSION,
      });

      return { verdicts, model: response.model };
    } catch (error) {
      log.warn('Rerank batch failed', { candidates: batch.length, error });

      return null;
    }
  }
}

export const llmReranker = new LlmReranker();
