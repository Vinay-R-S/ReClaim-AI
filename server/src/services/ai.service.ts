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
      color: { type: 'string' },
      category: { type: 'string' },
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

const ANALYSIS_PROMPT = `Analyze this image (or these images) of a lost/found item and provide:
1. A proper, descriptive name for the item
2. A detailed description (2-3 sentences) - if multiple images, synthesize details from all of them
3. Tags/attributes as an array - include features visible across all images
4. The primary color of the item (a single word like "Black", "Silver", "Red")
5. The most appropriate category (e.g., "Electronics", "Personal Accessories", "Documents", "Clothing", "Bags", "Keys", "Pets", "Other")

If multiple images are provided, analyze ALL of them together to create a comprehensive description.

Respond ONLY with valid JSON in this exact format:
{
  "name": "Item Name",
  "description": "Detailed description here.",
  "tags": ["tag1", "tag2"],
  "color": "ColorName",
  "category": "CategoryName"
}`;

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
        ? `${ANALYSIS_PROMPT}\n\nYou are analyzing ${images.length} images of the SAME item from different angles. Synthesize information from ALL images.`
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

    const prompt = `You are helping a lost and found system. A user has reported a lost item with the following details:

Name: ${body.name}
Description: ${body.description || 'None provided'}

Please:
1. Enhance the item name
2. Improve the description
3. Generate relevant tags
4. Identify the primary color
5. Identify the best category

Respond ONLY with valid JSON in this exact format:
{
  "name": "Enhanced Item Name",
  "description": "Enhanced detailed description here.",
  "tags": ["tag1", "tag2"],
  "color": "ColorName",
  "category": "CategoryName"
}`;

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
