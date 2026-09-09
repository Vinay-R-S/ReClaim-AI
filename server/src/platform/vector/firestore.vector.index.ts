/**
 * The Firestore adapter for the vector index.
 *
 * The index and the item collection are the same documents, which is the whole
 * argument of ADR 0003: a nearest-neighbour query can filter by type and
 * status in the same query it ranks by distance, where a separate store would
 * mean fetching a large candidate set and filtering it in application code.
 *
 * Requires a composite index whose trailing field is the vector one. See
 * `firestore.indexes.json`; a missing index surfaces as a FAILED_PRECONDITION
 * carrying a link to create it, and this turns that into a warning and an
 * empty result rather than a failed matching run.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { Query } from 'firebase-admin/firestore';
import { collections } from '../../utils/firebase-admin.js';
import { createLogger } from '../../utils/logger.js';
import type { VectorFilters, VectorHit, VectorIndex, VectorSearchOptions } from './vector.port.js';

const log = createLogger('vector:firestore');

/** Firestore's own ceiling on `findNearest`. */
const MAX_LIMIT = 1000;

const DISTANCE_FIELD = '__vectorDistance';

/** FAILED_PRECONDITION, which for a vector query means the index is missing. */
const FAILED_PRECONDITION = 9;

/** NOT_FOUND, which `update` raises for a document that is not there. */
const NOT_FOUND = 5;

/**
 * Fields that belong to the index rather than to a caller.
 *
 * A hit carries the stored document so that using it does not cost a second
 * read, and the stored document contains the vectors. The item repository
 * strips them on its own read paths for the same reason: several hundred
 * floats per item is payload nobody asked for, and leaving them on an object
 * that gets spread is how they reach a browser.
 */
const INTERNAL_FIELDS = ['embedding', 'imageEmbedding', DISTANCE_FIELD] as const;

/**
 * Said once per process.
 *
 * A missing index fails every search, and this is the one message an operator
 * needs. Logged at error level on every matching run it would be an alert
 * storm on a release that changed no behaviour.
 */
let missingIndexReported = false;

export class FirestoreVectorIndex implements VectorIndex {
  readonly id = 'firestore';

  constructor(private readonly items = collections.items) {}

  /**
   * Write a vector onto its document.
   *
   * The index is the collection, so an upsert is a field write. `set` with
   * merge rather than `update`, because the port says upsert and `update`
   * rejects a document that does not exist.
   *
   * `embeddingKey` is cleared rather than kept. It is the hash of the text the
   * embedding service last derived a vector from, and a vector written through
   * this port did not come from there; leaving the old hash would tell the
   * backfill the item was up to date and it would never be reconciled.
   */
  async upsert(
    id: string,
    vector: Float32Array,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.items.doc(id).set(
      {
        ...payload,
        embedding: FieldValue.vector(Array.from(vector)),
        embeddingKey: FieldValue.delete(),
        embeddedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /**
   * Remove a document from the index without removing the document.
   *
   * Deleting the item is the caller's business; this only takes it out of
   * retrieval, which is what a store-agnostic caller means by `deleteById`.
   * The whole set of fields that describe a vector goes, not just the vector:
   * a stored `embeddingModel` naming the encoder for a vector that is gone is
   * worse than no field at all.
   *
   * A document that is already gone satisfies the post-condition, so a
   * NOT_FOUND is success and not an error. Deleting the item and then
   * de-indexing it is the obvious order to do those two things in.
   */
  async deleteById(id: string): Promise<void> {
    try {
      await this.items.doc(id).update({
        embedding: FieldValue.delete(),
        imageEmbedding: FieldValue.delete(),
        embeddingKey: FieldValue.delete(),
        embeddingModel: FieldValue.delete(),
        imageEmbeddingModel: FieldValue.delete(),
        embeddedAt: FieldValue.delete(),
      });
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND) return;

      throw error;
    }
  }

  async search(
    vector: Float32Array,
    filters: VectorFilters,
    k: number,
    options: VectorSearchOptions = {},
  ): Promise<VectorHit[]> {
    const limit = Math.max(1, Math.min(k, MAX_LIMIT));

    let query: Query = this.items;

    if (filters.type) query = query.where('type', '==', filters.type);
    if (filters.status) query = query.where('status', '==', filters.status);

    try {
      const snapshot = await query
        .findNearest({
          vectorField: options.field ?? 'embedding',
          queryVector: Array.from(vector),
          limit,
          distanceMeasure: 'COSINE',
          distanceResultField: DISTANCE_FIELD,
          ...(options.maxDistance === undefined ? {} : { distanceThreshold: options.maxDistance }),
        })
        .get();

      return snapshot.docs.flatMap((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const distance = Number(data[DISTANCE_FIELD]);

        // A hit with no usable distance is dropped, not defaulted. Reading a
        // missing field as 0 would make it the nearest possible neighbour and
        // rank an unranked document above every real one.
        if (!Number.isFinite(distance)) {
          log.warn('Vector hit carried no distance, dropping it', { id: doc.id });

          return [];
        }

        // The SDK drops a `distanceThreshold` of 0 as falsy, and a bound is
        // worth enforcing here anyway rather than trusting the far end.
        if (options.maxDistance !== undefined && distance > options.maxDistance) return [];

        INTERNAL_FIELDS.forEach((field) => delete data[field]);

        return [{ id: doc.id, distance, data }];
      });
    } catch (error) {
      if ((error as { code?: number }).code === FAILED_PRECONDITION) {
        // The deploy step, not a bug in the query. Loudly once per process:
        // every matching run hits this, and an error line per report would be
        // an alert storm on a release that changed no behaviour.
        if (!missingIndexReported) {
          missingIndexReported = true;

          log.error(
            'Vector search needs a composite index that does not exist yet. Deploy firestore.indexes.json.',
            { error: (error as Error).message },
          );
        } else {
          log.debug('Vector search still has no index');
        }

        return [];
      }

      log.warn('Vector search failed', { error });

      return [];
    }
  }
}

export const firestoreVectorIndex = new FirestoreVectorIndex();

/** Test seam for the once-per-process missing-index report. */
export function resetVectorIndexWarnings(): void {
  missingIndexReported = false;
}
