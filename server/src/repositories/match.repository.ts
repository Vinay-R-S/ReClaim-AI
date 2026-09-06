/**
 * Match persistence.
 *
 * Covers both `matches`, which holds live proposals, and `matchHistory`, which
 * holds the ones a completed handover archived.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { collections } from '../utils/firebase-admin.js';
import type { Match } from '../types/index.js';

export type StoredMatch = Partial<Match> & { id: string };

export class MatchRepository {
  constructor(
    private readonly matches = collections.matches,
    private readonly history = collections.matchHistory,
  ) {}

  async findById(id: string): Promise<StoredMatch | null> {
    const doc = await this.matches.doc(id).get();

    if (!doc.exists) return null;

    return { ...(doc.data() as Match), id: doc.id };
  }

  async listActive(): Promise<StoredMatch[]> {
    const snapshot = await this.matches.orderBy('createdAt', 'desc').get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Match), id: doc.id }));
  }

  async listHistory(): Promise<StoredMatch[]> {
    const snapshot = await this.history.orderBy('createdAt', 'desc').get();

    return snapshot.docs.map((doc) => ({ ...(doc.data() as Match), id: doc.id }));
  }

  /** The live match for a pair, if one has been recorded. */
  async findByPair(lostItemId: string, foundItemId: string): Promise<StoredMatch | null> {
    const snapshot = await this.matches
      .where('lostItemId', '==', lostItemId)
      .where('foundItemId', '==', foundItemId)
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];

    return { ...(doc.data() as Match), id: doc.id };
  }

  /** Every live match an item takes part in, on either side of the pair. */
  async listForItem(itemId: string): Promise<StoredMatch[]> {
    const [lost, found] = await Promise.all([
      this.matches.where('lostItemId', '==', itemId).get(),
      this.matches.where('foundItemId', '==', itemId).get(),
    ]);

    return [...lost.docs, ...found.docs].map((doc) => ({
      ...(doc.data() as Match),
      id: doc.id,
    }));
  }

  async create(data: Record<string, unknown>): Promise<string> {
    const ref = await this.matches.add({ ...data, createdAt: FieldValue.serverTimestamp() });

    return ref.id;
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    await this.matches.doc(id).update({ ...data, updatedAt: FieldValue.serverTimestamp() });
  }

  async delete(id: string): Promise<void> {
    await this.matches.doc(id).delete();
  }
}

export const matchRepository = new MatchRepository();
