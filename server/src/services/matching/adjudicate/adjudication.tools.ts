/**
 * The tools the adjudication agent is allowed to use.
 *
 * Section 8.6 names six. Five of them are deterministic reads: an item, a
 * distance, a time delta, a cosine between two stored image vectors, a count
 * of what a user has filed. Only `search_similar` touches a model, and only to
 * embed the query.
 *
 * That is deliberate. An agent whose tools are all model calls is a model
 * asking itself questions; an agent whose tools return facts can be wrong
 * about what the facts mean but not about what they are. It is also what keeps
 * the run inside its time budget, because five of the six are one Firestore
 * read or no read at all.
 *
 * ## What a tool is not allowed to do
 *
 * Write anything. Nothing here mutates, and the agent has no path to a write
 * even by accident: the verdict it returns is a recommendation that
 * deterministic code in the pipeline acts on.
 *
 * Reach outside the pair. `get_item` and `get_claim_history` are allowlisted,
 * to the two items being adjudicated plus whatever `search_similar` has
 * legitimately surfaced, and to the two reporters of those items. Without that
 * an agent whose prompt has been steered by an attacker-written description is
 * a user enumeration endpoint that answers in natural language.
 *
 * Return raw untrusted text. Every item field a tool returns goes through the
 * same sanitiser and the same per-run fence the reranker uses, because a tool
 * result is one more place attacker-written text re-enters the context — and a
 * later one, where the model has already been told to trust what it is
 * reading.
 */

import { z } from 'zod';
import { itemRepository, ItemRepository } from '../../../repositories/item.repository.js';
import { embeddingService, EmbeddingService } from '../../embedding.service.js';
import { firestoreVectorIndex } from '../../../platform/vector/firestore.vector.index.js';
import { cosineSimilarity, type VectorIndex } from '../../../platform/vector/vector.port.js';
import { haversineDistance, calculateTimeDifference } from '../../../utils/scoring.js';
import { createLogger } from '../../../utils/logger.js';
import { toDate } from '../../../utils/firestore.js';
import { sanitise } from '../rerank/rerank.prompt.js';
import type { Item, ItemType } from '../../../types/index.js';
import type { MatchSubject } from '../matching.types.js';

const log = createLogger('matching:adjudicate:tools');

/** The id the subject answers to when it is a search rather than a stored item. */
export const SUBJECT_ID = 'subject';

/** Ids `search_similar` may add to the allowlist in one run. */
const SEARCH_RESULTS = 5;

/** Longest tool result kept, in characters. The trace is stored on a document. */
export const MAX_RESULT_LENGTH = 1200;

/** How far back `get_claim_history` calls a report recent. */
const RECENT_DAYS = 7;

/** Most reports `get_claim_history` will read for one account. */
const CLAIM_HISTORY_CAP = 200;

export interface ToolSpec {
  name: ToolName;
  /** One line for the prompt. The model reads this and nothing else about it. */
  description: string;
  /** The argument names, for the prompt. Validation is the schema below. */
  args: string;
}

/**
 * The tool names, as a tuple.
 *
 * A tuple rather than an array because the agent's step schema validates
 * against it with `z.enum`. Only zod actually validates: the JSON Schema is a
 * prompt hint on every provider except OpenAI, so a name checked in the JSON
 * Schema alone is not checked at all, and an unchecked name is echoed straight
 * back into the transcript in the refusal that names it.
 */
export const TOOL_NAMES = [
  'get_item',
  'compare_images',
  'geo_distance',
  'time_delta',
  'search_similar',
  'get_claim_history',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_item',
    description: 'The full stored report for one id, including every field the reporter wrote.',
    args: 'itemId',
  },
  {
    name: 'compare_images',
    description:
      'Visual similarity between the two reports photographs, as a cosine from 0 to 1. Unavailable when either has no usable photograph.',
    args: 'itemId, otherItemId',
  },
  {
    name: 'geo_distance',
    description: 'Kilometres between the two reports coordinates.',
    args: 'itemId, otherItemId',
  },
  {
    name: 'time_delta',
    description: 'Hours between the two reports dates, and which came first.',
    args: 'itemId, otherItemId',
  },
  {
    name: 'search_similar',
    description:
      'Other reports resembling a description. Use it to find out whether a report is one of many near-identical ones, which makes any single pairing weaker.',
    args: 'text, type',
  },
  {
    name: 'get_claim_history',
    description:
      'How much the person who filed one of these two reports has filed altogether, in total and in the last week. Counts only, never who they are.',
    args: 'itemId',
  },
];

/**
 * Every argument any tool takes, in one flat object.
 *
 * A discriminated union would be the honest shape, and it is the wrong one
 * here: this schema is also sent to the provider as JSON Schema, and a
 * `oneOf` across six variants is the construct provider schema modes are least
 * consistent about supporting. So the wire shape is flat and permissive, and
 * each tool validates the arguments it actually needs below. A tool given the
 * wrong arguments answers with what it wanted, which the agent can act on.
 */
export const TOOL_ARGS_SCHEMA = z.object({
  itemId: z.string().max(128).optional(),
  otherItemId: z.string().max(128).optional(),
  text: z.string().max(600).optional(),
  type: z.enum(['Lost', 'Found']).optional(),
});

export type ToolArgs = z.infer<typeof TOOL_ARGS_SCHEMA>;

export interface ToolOutcome {
  result: string;
  /** True when the tool refused. The agent is told, and may try something else. */
  failed: boolean;
}

/** One side of the pair, in the shape the tools need it. */
interface Party {
  id: string;
  label: string;
  type: ItemType;
  name?: string;
  description?: string;
  category?: string;
  color?: string;
  tags?: string[];
  location?: string;
  coordinates?: { lat: number; lng: number };
  date: Date | null;
  reportedBy?: string;
  status?: string;
}

function partyFromSubject(subject: MatchSubject, type: ItemType): Party {
  return {
    id: subject.id ?? SUBJECT_ID,
    label: `the ${type.toLowerCase()} report being matched`,
    type,
    name: subject.name,
    description: subject.description,
    category: subject.category,
    color: subject.color,
    tags: subject.tags,
    location: subject.location,
    coordinates: subject.coordinates,
    date: subject.date,
    reportedBy: subject.reportedBy,
  };
}

function partyFromItem(item: Item, label: string): Party {
  return {
    id: item.id as string,
    label,
    type: item.type,
    name: item.name,
    description: item.description,
    category: item.category,
    color: item.color,
    tags: item.tags,
    location: item.location,
    coordinates: item.coordinates,
    date: toDate(item.date),
    reportedBy: item.reportedBy,
    status: item.status,
  };
}

export interface ToolDependencies {
  items?: ItemRepository;
  embeddings?: EmbeddingService;
  vectors?: VectorIndex;
}

/**
 * The tool surface for one adjudication run.
 *
 * One instance per run, because the allowlist and the item cache are per run:
 * a shared instance would let one adjudication read the ids another one
 * surfaced, which is the whole guard gone.
 */
export class AdjudicationTools {
  private readonly parties = new Map<string, Party>();

  /** Ids `get_item` will answer for. Grows only through `search_similar`. */
  private readonly allowedItemIds = new Set<string>();

  /**
   * The two ids of the pair, which is narrower than the list above.
   *
   * `get_claim_history` answers only for these. A report `search_similar`
   * surfaced belongs to a third party who is not part of this decision, and
   * counting what they have filed is not evidence about this pair.
   */
  private readonly pairIdSet = new Set<string>();

  private readonly items: ItemRepository;

  private readonly embeddings: EmbeddingService;

  private readonly vectors: VectorIndex;

  constructor(
    subject: MatchSubject,
    subjectType: ItemType,
    candidate: Item,
    private readonly fence: string,
    dependencies: ToolDependencies = {},
  ) {
    this.items = dependencies.items ?? itemRepository;
    this.embeddings = dependencies.embeddings ?? embeddingService;
    this.vectors = dependencies.vectors ?? firestoreVectorIndex;

    const subjectParty = partyFromSubject(subject, subjectType);
    const candidateParty = partyFromItem(candidate, 'the candidate it is being compared against');

    [subjectParty, candidateParty].forEach((party) => {
      this.parties.set(party.id, party);
      this.allowedItemIds.add(party.id);
      this.pairIdSet.add(party.id);
    });
  }

  /** The two ids the prompt introduces, so it and the tools cannot disagree. */
  pairIds(): { subjectId: string; candidateId: string } {
    const [subjectId, candidateId] = [...this.parties.keys()];

    return { subjectId, candidateId };
  }

  /** The party record for an id, for the prompt's opening description. */
  party(id: string): Party | undefined {
    return this.parties.get(id);
  }

  async call(name: string, args: ToolArgs): Promise<ToolOutcome> {
    switch (name) {
      case 'get_item':
        return this.getItem(args);
      case 'compare_images':
        return this.compareImages(args);
      case 'geo_distance':
        return this.geoDistance(args);
      case 'time_delta':
        return this.timeDelta(args);
      case 'search_similar':
        return this.searchSimilar(args);
      case 'get_claim_history':
        return this.claimHistory(args);
      default:
        return refuse(`There is no tool called "${name}". The tools are: ${TOOL_NAMES.join(', ')}.`);
    }
  }

  /**
   * Untrusted text, fenced with this run's nonce.
   *
   * Same treatment as the reranker's, and for a reason specific to this stage:
   * the agent has already been told the transcript above is the operator
   * talking, so a tool result is the one place where attacker text arrives
   * with the model's guard down.
   */
  private fenced(value: string | undefined): string {
    if (!value || !value.trim()) return '(none)';

    return `<<${this.fence}|${sanitise(value.trim()).text}|${this.fence}>>`;
  }

  private async resolve(id: string | undefined): Promise<Party | null> {
    if (!id) return null;

    const known = this.parties.get(id);

    if (known) return known;
    if (!this.allowedItemIds.has(id)) return null;

    const item = await this.items.findById(id);

    if (!item) return null;

    const party = partyFromItem(item, 'a report found by search');

    this.parties.set(id, party);

    return party;
  }

  /** The two ids a pairwise tool was given, or the refusal to answer with. */
  private async resolvePair(args: ToolArgs): Promise<{ a: Party; b: Party } | ToolOutcome> {
    const [a, b] = await Promise.all([this.resolve(args.itemId), this.resolve(args.otherItemId)]);

    if (!a || !b) {
      return refuse(
        `This tool needs itemId and otherItemId, both of which must be ids you have already seen. Known ids: ${[...this.allowedItemIds].join(', ')}.`,
      );
    }

    if (a.id === b.id) return refuse('itemId and otherItemId are the same report.');

    return { a, b };
  }

  private async getItem(args: ToolArgs): Promise<ToolOutcome> {
    const party = await this.resolve(args.itemId);

    if (!party) {
      return refuse(
        `No report with that id is available. Known ids: ${[...this.allowedItemIds].join(', ')}.`,
      );
    }

    return {
      failed: false,
      result: [
        `id: ${party.id} (${party.type})`,
        `name: ${this.fenced(party.name)}`,
        `category: ${this.fenced(party.category)}`,
        `colour: ${this.fenced(party.color)}`,
        `tags: ${this.fenced((party.tags ?? []).join(', '))}`,
        `description: ${this.fenced(party.description)}`,
        `location: ${this.fenced(party.location)}`,
        `coordinates: ${party.coordinates ? `${party.coordinates.lat.toFixed(4)}, ${party.coordinates.lng.toFixed(4)}` : '(none)'}`,
        `reported: ${party.date ? party.date.toISOString() : '(unknown)'}`,
        `status: ${party.status ?? '(not stored yet)'}`,
        `has photograph: ${party.id === SUBJECT_ID ? 'unknown' : 'see compare_images'}`,
      ].join('\n'),
    };
  }

  /**
   * Cosine between the two stored image vectors.
   *
   * Stored vectors rather than a vision call: the vector was computed once at
   * ingest, so this is arithmetic on two arrays and costs nothing, and it is
   * the same signal the retrieval stage uses rather than a second opinion on a
   * different scale.
   */
  private async compareImages(args: ToolArgs): Promise<ToolOutcome> {
    const pair = await this.resolvePair(args);

    if ('result' in pair) return pair;

    if (pair.a.id === SUBJECT_ID || pair.b.id === SUBJECT_ID) {
      return refuse('One of these reports is not stored yet, so it has no image vector.');
    }

    const [left, right] = await Promise.all([
      this.items.findByIdWithVectors(pair.a.id),
      this.items.findByIdWithVectors(pair.b.id),
    ]);

    if (left?.imageEmbeddingModel && right?.imageEmbeddingModel) {
      if (left.imageEmbeddingModel !== right.imageEmbeddingModel) {
        return {
          failed: false,
          result:
            'unavailable: the two image vectors were produced by different models and cannot be compared.',
        };
      }
    }

    if (!left?.imageEmbedding || !right?.imageEmbedding) {
      const without = [
        !left?.imageEmbedding ? pair.a.id : null,
        !right?.imageEmbedding ? pair.b.id : null,
      ].filter(Boolean);

      return {
        failed: false,
        result: `unavailable: no image vector for ${without.join(' and ')}. Treat the photographs as no evidence either way, not as evidence against.`,
      };
    }

    const similarity = cosineSimilarity(left.imageEmbedding, right.imageEmbedding);

    if (similarity === null) {
      return {
        failed: false,
        result:
          'unavailable: the two image vectors were produced by different models and cannot be compared.',
      };
    }

    return {
      failed: false,
      result: [
        `image cosine: ${similarity.toFixed(3)}`,
        'Above 0.85 is strong agreement, 0.6 to 0.85 is the same kind of object,',
        'below 0.6 is weak. Photographs of one object taken by two people in two',
        'places differ in lighting and angle, so a middling number is not evidence against.',
      ].join('\n'),
    };
  }

  private async geoDistance(args: ToolArgs): Promise<ToolOutcome> {
    const pair = await this.resolvePair(args);

    if ('result' in pair) return pair;

    if (!pair.a.coordinates || !pair.b.coordinates) {
      const without = [
        !pair.a.coordinates ? pair.a.id : null,
        !pair.b.coordinates ? pair.b.id : null,
      ].filter(Boolean);

      return {
        failed: false,
        result: `unavailable: no coordinates on ${without.join(' and ')}. The written locations are ${this.fenced(pair.a.location)} and ${this.fenced(pair.b.location)}.`,
      };
    }

    const km = haversineDistance(
      pair.a.coordinates.lat,
      pair.a.coordinates.lng,
      pair.b.coordinates.lat,
      pair.b.coordinates.lng,
    );

    return { failed: false, result: `distance: ${km.toFixed(2)} km` };
  }

  private async timeDelta(args: ToolArgs): Promise<ToolOutcome> {
    const pair = await this.resolvePair(args);

    if ('result' in pair) return pair;

    if (!pair.a.date || !pair.b.date) {
      return refuse('One of these reports has no usable date.');
    }

    const hours = calculateTimeDifference(pair.a.date, pair.b.date);
    const earlier = pair.a.date <= pair.b.date ? pair.a : pair.b;

    return {
      failed: false,
      result: [
        `hours apart: ${hours.toFixed(1)}`,
        `earlier report: ${earlier.id} (${earlier.type})`,
        'A found report dated before the loss it is supposed to answer is a contradiction.',
      ].join('\n'),
    };
  }

  /**
   * Other reports resembling a description.
   *
   * The question it answers is the one a score cannot: whether this candidate
   * is the only plausible answer or one of nine identical black umbrellas. A
   * pair that looks strong in isolation and sits in a crowd of near-duplicates
   * is a pair to hand to a person.
   */
  private async searchSimilar(args: ToolArgs): Promise<ToolOutcome> {
    const text = args.text?.trim();

    if (!text) return refuse('This tool needs a text description to search for.');

    if (!this.embeddings.isEnabled()) {
      return { failed: false, result: 'unavailable: semantic search is switched off.' };
    }

    const type = args.type ?? this.parties.get(this.pairIds().candidateId)?.type;

    if (!type) return refuse('This tool needs a type of either "Lost" or "Found".');

    try {
      const [vector] = await this.embeddings.embedTexts([text]);
      const hits = await this.vectors.search(vector, { type, status: 'Pending' }, SEARCH_RESULTS);

      if (hits.length === 0) {
        return { failed: false, result: `No other ${type} report resembles that description.` };
      }

      // The vector query filters on type and status only, so everything the
      // pipeline filters in memory has to be filtered here too. A rejected
      // report keeps its `Pending` status and its vector, and surfacing one
      // would allowlist it, copy its text into a match document belonging to
      // two unrelated people, and undo the moderator's decision.
      const visible = hits.filter((hit) => {
        if (this.parties.has(hit.id)) return false;

        const { moderation } = hit.data as { moderation?: string };

        return moderation === undefined || moderation === 'approved';
      });

      if (visible.length === 0) {
        return { failed: false, result: `No other ${type} report resembles that description.` };
      }

      const lines = visible.map((hit) => {
        this.allowedItemIds.add(hit.id);

        const data = hit.data as { name?: string; color?: string };

        return `${hit.id} (distance ${hit.distance.toFixed(3)}): ${this.fenced([data.color, data.name].filter(Boolean).join(' '))}`;
      });

      return {
        failed: false,
        result: [
          `${visible.length} similar ${type} report(s), nearest first:`,
          ...lines,
          'Several near-identical reports mean any single pairing is weaker, not stronger.',
        ].join('\n'),
      };
    } catch (error) {
      log.warn('search_similar failed', { error });

      return { failed: false, result: 'unavailable: the search could not be run.' };
    }
  }

  /**
   * What a reporter has filed. Counts only.
   *
   * Never a name, an email or an item title: this exists to answer "is this
   * person filing a claim a week", and every field that would answer anything
   * else is a field an injected description could talk the agent into reading
   * out. The allowlist is the two reporters of the pair.
   */
  private async claimHistory(args: ToolArgs): Promise<ToolOutcome> {
    const itemId = args.itemId?.trim();

    if (!itemId || !this.pairIdSet.has(itemId)) {
      return refuse(
        `This tool answers only for the two reports being adjudicated: ${[...this.pairIdSet].join(' and ')}.`,
      );
    }

    // The agent names a report, never a person. A uid is never put in front of
    // a model, so it cannot be steered into asking about somebody else's.
    const userId = this.parties.get(itemId)?.reportedBy;

    if (!userId) {
      return { failed: false, result: 'unavailable: that report has no reporter on record.' };
    }

    // Capped, because the pathological input is the expected one: this tool
    // exists to spot a serial filer, and without a bound one adjudication
    // touching an account with twenty thousand reports is a twenty thousand
    // document read inside a call the run deadline cannot interrupt.
    const reports = await this.items.listAllByReporter(userId, CLAIM_HISTORY_CAP);
    const capped = reports.length >= CLAIM_HISTORY_CAP;
    const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;

    const recent = reports.filter((item) => {
      const date = toDate(item.date);

      return date !== null && date.getTime() >= since;
    }).length;

    const counts = reports.reduce(
      (totals, item) => ({
        lost: totals.lost + (item.type === 'Lost' ? 1 : 0),
        found: totals.found + (item.type === 'Found' ? 1 : 0),
        claimed: totals.claimed + (item.status === 'Claimed' ? 1 : 0),
      }),
      { lost: 0, found: 0, claimed: 0 },
    );

    return {
      failed: false,
      result: [
        `reports filed: ${capped ? `${CLAIM_HISTORY_CAP} or more` : reports.length} (${counts.lost} lost, ${counts.found} found)`,
        `completed handovers: ${counts.claimed}`,
        `filed in the last ${RECENT_DAYS} days: ${recent}`,
        'A normal reporter files once. Many reports in a week is a reason for caution,',
        'not proof of anything.',
      ].join('\n'),
    };
  }
}

function refuse(message: string): ToolOutcome {
  return { result: message, failed: true };
}

/**
 * Cut a tool result to length without leaving a fence open.
 *
 * The tools assemble their answers out of `<<nonce| ... |nonce>>` fences, and
 * the caller has to bound what it sends to the model and stores on a document.
 * Cutting the assembled string can land inside a fence, and an unterminated
 * fence puts everything after it — the next tool result header, the final-turn
 * instruction — inside the region the system prompt says is untrusted.
 *
 * Field caps are public knowledge, so where the cut lands is attacker-chosen.
 * This closes what the cut opened, which makes the balance a property of the
 * code rather than of arithmetic nobody rechecks when a field cap changes.
 */
export function clampResult(text: string, fence: string, max = MAX_RESULT_LENGTH): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const marker = `|${fence}`;
  const opens = cut.split(`<<${fence}|`).length - 1;
  const closes = cut.split(`${marker}>>`).length - 1;

  return opens > closes ? `${cut}${marker}>>` : cut;
}
