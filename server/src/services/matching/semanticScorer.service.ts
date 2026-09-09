/**
 * Semantic scoring stage.
 *
 * One prompt, one place. `matching.ts` and `autoMatch.service.ts` each carried
 * their own copy with different wording and different temperatures, so the same
 * pair scored differently depending on which entry point asked.
 */

import { Item } from '../../types/index.js';
import { aiRouter } from '../../platform/ai/index.js';
import { createLogger } from '../../utils/logger.js';
import { MatchSubject, SemanticScorer } from './matching.types.js';

const log = createLogger('matching:semantic');

interface Comparable {
  name: string;
  description?: string;
  tags?: string[];
}

function buildPrompt(a: Comparable, b: Comparable): string {
  return `You are an expert at identifying if two lost/found item descriptions refer to the SAME physical object.

Item A:
Name: ${a.name}
Description: ${a.description || ''}
Tags: ${a.tags?.join(', ') || 'None'}

Item B:
Name: ${b.name}
Description: ${b.description || ''}
Tags: ${b.tags?.join(', ') || 'None'}

SCORING GUIDELINES:
- 90-100: Almost certainly the same item (same type, color, key features match)
- 75-89: Very likely the same (most details align, minor differences acceptable)
- 60-74: Possibly the same (similar type, some details match)
- 40-59: Uncertain (same category but significant differences)
- 20-39: Probably different (same general type but key details don't match)
- 0-19: Definitely different items

IMPORTANT:
- Focus on OBJECT TYPE, COLOR, DISTINGUISHING FEATURES
- Ignore minor spelling differences, word order, or phrasing variations
- "Blue backpack with laptop compartment" = "Backpack (blue) for laptops" = HIGH SCORE
- Different colors of same item type = MEDIUM score (50-60)
- Same category but different subtypes = LOW score (20-40)
- Completely different items = 0-10

Return ONLY a number from 0-100.`;
}

/**
 * Read a 0-100 number out of the model's reply.
 *
 * Stripping every non-digit and parsing the remainder concatenated the digits
 * of a chatty reply: "85/100" became 85100, which clamped to a perfect 100 and
 * auto-matched two unrelated reports. A fraction is read as a fraction, and
 * anything else takes the first standalone one-to-three digit number.
 *
 * Returns null rather than 0 for an unparseable reply: "the model did not
 * answer" and "the model said they are unrelated" must not normalise the same.
 */
export function parseScore(content: string): number | null {
  const text = content.trim();

  const fraction = text.match(/(\d{1,3})\s*(?:\/|\s+out\s+of\s+)\s*(\d{1,3})/i);

  if (fraction) {
    const value = Number.parseInt(fraction[1], 10);
    const outOf = Number.parseInt(fraction[2], 10);

    if (outOf > 0) return clamp(Math.round((value / outOf) * 100));
  }

  const standalone = text.match(/\d{1,3}/);

  if (!standalone) return null;

  const value = Number.parseInt(standalone[0], 10);

  if (Number.isNaN(value) || value > 100) return null;

  return clamp(value);
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export class LlmSemanticScorer implements SemanticScorer {
  /**
   * The timeout, the retries and the fallback provider are the router's, from
   * the `match.semantic` policy. This stage owns the prompt and the parse.
   */
  async score(a: MatchSubject, b: Item): Promise<number | null> {
    try {
      const response = await aiRouter.chat('match.semantic', {
        messages: [
          {
            role: 'system',
            content:
              'You are a precise semantic matching engine. Be confident when items clearly match. Output only a number 0-100.',
          },
          { role: 'user', content: buildPrompt(a, b) },
        ],
      });

      return parseScore(response.content);
    } catch (error) {
      log.error('Semantic score failed:', error);
      return null;
    }
  }
}
