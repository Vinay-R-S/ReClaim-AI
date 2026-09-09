/**
 * Item analysis for the report and add-item flows.
 *
 * These exist so that no LLM key ever reaches the browser (defect SEC-16). The
 * provider is chosen by the router from the admin setting and the task policy,
 * so that setting governs client-triggered analysis as well as server-side
 * work.
 */

import { z } from 'zod';
import {
  aiRouter,
  defineStructured,
  providerRegistry,
  StructuredOutputError,
} from '../platform/ai/index.js';
import { AppError } from '../middleware/errorHandler.middleware.js';
import { CATEGORIES, COLOURS, DESCRIPTION_RULES } from './vocabulary.js';
import { createLogger } from '../utils/logger.js';
import type { AnalyzeImageBody, EnhanceDescriptionBody } from '../schemas/index.js';

const log = createLogger('ai.service');

/**
 * The shape both analysis calls must return.
 *
 * Every field is optional here and filled in by `toAnalysis`: a model that
 * omits the colour has still been useful, and rejecting the whole reply for
 * one missing field would send the user back to typing it all by hand. The
 * JSON Schema is stricter because that is what a provider constrains against.
 */
const ITEM_ANALYSIS = defineStructured({
  name: 'item_analysis',
  schema: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    color: z.string().optional(),
    category: z.string().optional(),
  }),
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'description', 'tags', 'color', 'category'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      // Enumerated here as well as in the prompt, so a provider that
      // constrains output enforces the vocabulary rather than asking for it.
      // The empty string is allowed because "not stated" is a real answer and
      // a guessed colour is worse than a missing one.
      color: { type: 'string', enum: ['', ...COLOURS] },
      category: { type: 'string', enum: [...CATEGORIES] },
    },
  },
});

export interface ItemAnalysis {
  name: string;
  description: string;
  tags: string[];
  color: string;
  category: string;
}

/** What the client shows when the model gave nothing usable. */
const EMPTY_ANALYSIS: ItemAnalysis = {
  name: 'Unknown Item',
  description: 'AI analysis failed. Please add details manually.',
  tags: [],
  color: '',
  category: 'Other',
};

/**
 * The image-analysis prompt.
 *
 * What it is really for is not describing the photograph; it is producing the
 * fields the matching pipeline will later compare against somebody else's
 * description of the same object, written from memory and in different words.
 * So it asks for what survives that translation: an identifier, a brand, a
 * model, a mark you could check — and for a colour and a category from closed
 * lists, because a free-choice "Dark" and a free-choice "Black" describe one
 * wallet and match on nothing.
 *
 * It does not ask for JSON. The router constrains the reply against a schema
 * and validates it, so a hand-written format block would be a second, weaker
 * copy of the contract that can disagree with the first.
 */
const ANALYSIS_PROMPT = [
  'You are cataloguing an object for a lost-property office.',
  '',
  'Describe the object in the image well enough that the person who lost it,',
  'writing from memory and without seeing your text, could be matched to it.',
  '',
  DESCRIPTION_RULES,
  '',
  'Fields:',
  '- name: what the object is, specific but short. "Sony WH-CH720N headphones",',
  '  not "a pair of headphones" and not "Black Sony over-ear wireless',
  '  headphones in good condition".',
  '- description: two or three sentences. Lead with the object type and any',
  '  identifier, then brand and model, then distinguishing marks, contents or',
  '  damage. Say what is visible; do not speculate about how it was lost.',
  '- tags, color, category: as the rules above.',
].join('\n');

export class AiService {
  isAvailable(): boolean {
    return providerRegistry.available().length > 0;
  }

  /**
   * Describe one or more images of the same item.
   *
   * An unparseable reply is not an error: the report form fills in what it can
   * and the user finishes it by hand.
   */
  async analyzeImages(body: AnalyzeImageBody): Promise<ItemAnalysis> {
    if (!this.isAvailable()) {
      throw new AppError('AI analysis is not configured', 503);
    }

    const { images } = body;
    const prompt =
      images.length > 1
        ? [
            ANALYSIS_PROMPT,
            '',
            `These ${images.length} images are the same object from different angles.`,
            'Describe it once, using every angle: a serial number or a mark visible',
            'in only one of them still belongs in the description.',
          ].join('\n')
        : ANALYSIS_PROMPT;

    try {
      const { value, response } = await aiRouter.chatStructured(
        'item.analyze',
        {
          messages: [{ role: 'user', content: prompt }],
          images: images.map((image) => ({
            base64: image.base64.includes(',') ? image.base64.split(',')[1] : image.base64,
            mimeType: image.mimeType,
          })),
        },
        ITEM_ANALYSIS,
      );

      log.debug('Image analysis complete', { provider: response.providerId });

      return toAnalysis(value);
    } catch (error) {
      // A model that answered badly is not worth an error to a user who can
      // type the fields themselves. Everything else is: an outage answered
      // with placeholder text is a 200 the client cannot tell from a result,
      // and it ends up as an item literally named "Unknown Item".
      if (error instanceof StructuredOutputError) {
        log.warn('Image analysis returned an unusable reply', { error });

        return EMPTY_ANALYSIS;
      }

      log.warn('Image analysis failed', { error });

      throw new AppError('AI analysis is unavailable right now', 503);
    }
  }

  /**
   * Improve a typed report that has no image, used for Lost items.
   *
   * The original text is the fallback at every step: enhancement is a
   * convenience and must never lose what the user typed.
   */
  async enhanceDescription(body: EnhanceDescriptionBody): Promise<ItemAnalysis> {
    const original: ItemAnalysis = {
      name: body.name,
      description: body.description || '',
      tags: [],
      color: '',
      category: body.category || 'Other',
    };

    if (!this.isAvailable()) return original;

    // Structuring, not enhancing. The old prompt said "enhance the item name"
    // and "improve the description", which invites a model to embellish a
    // report somebody wrote from memory: the invented detail then becomes
    // evidence in a comparison, and a specific that was never true is worse
    // than a vague one that was.
    const prompt = [
      'Somebody has reported a lost object. Reorganise what they wrote into the',
      'fields below so it can be compared against found-property reports.',
      '',
      'You are extracting and tidying, not improving. Every fact in your answer',
      'must be present in their text. Do not add a brand, a material, a size or',
      'a condition they did not mention, however likely it seems.',
      '',
      DESCRIPTION_RULES,
      '',
      'What they wrote:',
      `  name: ${body.name}`,
      `  description: ${body.description || '(nothing)'}`,
      '',
      'Fields:',
      '- name: their object, said plainly. Keep any brand or model they gave.',
      '- description: their details, ordered with identifier and brand first.',
      '  If they wrote little, your description is short. Do not pad it.',
      '- tags, color, category: as the rules above. Leave colour empty if they',
      '  did not say what colour it was.',
    ].join('\n');

    try {
      const { value } = await aiRouter.chatStructured(
        'item.enhance',
        { messages: [{ role: 'user', content: prompt }] },
        ITEM_ANALYSIS,
      );

      return toAnalysis(value, original);
    } catch (error) {
      log.warn('Description enhancement failed, returning the original text', { error });

      return original;
    }
  }
}

/** Coerce whatever the model returned into the shape the client expects. */
function toAnalysis(raw: unknown, fallback: Partial<ItemAnalysis> = {}): ItemAnalysis {
  const parsed = (raw ?? {}) as Partial<ItemAnalysis>;

  return {
    name: parsed.name || fallback.name || 'Unknown Item',
    description: parsed.description || fallback.description || 'No description available',
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10).map(String) : [],
    color: parsed.color || '',
    category: parsed.category || fallback.category || 'Other',
  };
}

export const aiService = new AiService();
