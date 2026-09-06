/**
 * Handover persistence: the code documents, the completed records, and the
 * audit trail of admin overrides.
 *
 * Completion writes across four collections at once, so the batch lives here
 * rather than in the service. Splitting it across one repository per collection
 * would mean giving up the atomicity, and a handover that records the item as
 * claimed but never writes the handover document is exactly the failure the
 * batch exists to prevent.
 */

import { DocumentReference, FieldValue } from 'firebase-admin/firestore';
import { collections, db } from '../utils/firebase-admin.js';
import { createLogger } from '../utils/logger.js';
import type { HandoverCode, Item } from '../types/index.js';

const log = createLogger('handover.repository');

export interface CompletionContext {
  lostItem: (Item & { id: string }) | null;
  foundItem: (Item & { id: string }) | null;
  matchData: FirebaseFirestore.DocumentData | null;
}

export interface CompletionWrite {
  matchId: string;
  codeDocRef: DocumentReference;
  /** The handover record, already shaped by the service. */
  record: Record<string, unknown>;
  /** The live match to archive, or null when the match was never persisted. */
  matchData: FirebaseFirestore.DocumentData | null;
  lostItemId: string;
  foundItemId: string;
  lostItemExists: boolean;
  foundItemExists: boolean;
}

export class HandoverRepository {
  constructor(
    private readonly handovers = collections.handovers,
    private readonly codes = collections.handoverCodes,
    private readonly audit = collections.handoverAudit,
    private readonly items = collections.items,
    private readonly matches = collections.matches,
    private readonly matchHistory = collections.matchHistory,
    private readonly firestore = db,
  ) {}

  /**
   * Resolve the one code document for a match.
   *
   * New sessions live at `handoverCodes/{matchId}`, so two concurrent initiates
   * address the same document instead of each adding one and emailing a code
   * the other invalidates. Documents created before that change carry a random
   * id, so a miss falls back to a query and, if duplicates already exist, takes
   * the newest rather than an arbitrary one.
   */
  async resolveCodeRef(
    matchId: string,
    readCreatedAt: (value: unknown) => Date | null,
  ): Promise<DocumentReference> {
    const direct = this.codes.doc(matchId);
    const directSnap = await direct.get();

    if (directSnap.exists) return direct;

    const legacy = await this.codes.where('matchId', '==', matchId).get();

    if (legacy.empty) return direct;

    const newest = legacy.docs.reduce((latest, doc) => {
      const candidate = readCreatedAt(doc.data()?.createdAt)?.getTime() ?? 0;
      const current = readCreatedAt(latest.data()?.createdAt)?.getTime() ?? 0;

      return candidate > current ? doc : latest;
    });

    return newest.ref;
  }

  /** A transaction over the code document, which is where the races are. */
  runTransaction<T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(fn);
  }

  /** Never throws: an audit write must not take the operation down with it. */
  async writeAudit(entry: Record<string, unknown>): Promise<void> {
    await this.audit.add({ ...entry, createdAt: FieldValue.serverTimestamp() });
  }

  /** The three documents completion needs, read together. */
  async loadCompletionContext(
    matchId: string,
    lostItemId: string,
    foundItemId: string,
  ): Promise<CompletionContext & { lostItemExists: boolean; foundItemExists: boolean }> {
    const [lostDoc, foundDoc, matchDoc] = await Promise.all([
      this.items.doc(lostItemId).get(),
      this.items.doc(foundItemId).get(),
      this.matches.doc(matchId).get(),
    ]);

    return {
      lostItem: lostDoc.exists
        ? ({ ...lostDoc.data(), id: lostDoc.id } as Item & { id: string })
        : null,
      foundItem: foundDoc.exists
        ? ({ ...foundDoc.data(), id: foundDoc.id } as Item & { id: string })
        : null,
      matchData: matchDoc.exists ? (matchDoc.data() ?? null) : null,
      lostItemExists: lostDoc.exists,
      foundItemExists: foundDoc.exists,
    };
  }

  /**
   * The completion write, as one batch.
   *
   * The handover document id is the match id, so a retry after a partial
   * failure rewrites the same document instead of leaving a second one behind.
   */
  async completeHandover(write: CompletionWrite): Promise<DocumentReference> {
    const batch = this.firestore.batch();
    const handoverRef = this.handovers.doc(write.matchId);

    batch.set(handoverRef, write.record);

    // Link the completed handover back to the code document.
    batch.set(write.codeDocRef, { handoverId: handoverRef.id }, { merge: true });

    // Archive the match, then remove it from the active collection. Both steps
    // are skipped when the match was synthesized and never persisted.
    if (write.matchData) {
      batch.set(this.matchHistory.doc(write.matchId), {
        ...write.matchData,
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        handoverId: handoverRef.id,
      });
      batch.delete(this.matches.doc(write.matchId));
    }

    // Items, only the ones that still exist.
    if (write.lostItemExists) {
      batch.update(this.items.doc(write.lostItemId), {
        status: 'Claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (write.foundItemExists) {
      batch.update(this.items.doc(write.foundItemId), {
        status: 'Claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();

    return handoverRef;
  }

  async findCodeByMatch(matchId: string): Promise<HandoverCode | null> {
    const doc = await this.codes.doc(matchId).get();

    if (!doc.exists) return null;

    return doc.data() as HandoverCode;
  }

  /** The two items a session refers to, for the notices it has to send. */
  async loadSessionItems(
    lostItemId: string,
    foundItemId: string,
  ): Promise<{ lostItem: Item | null; foundItem: Item | null }> {
    const [lostDoc, foundDoc] = await Promise.all([
      this.items.doc(lostItemId).get(),
      this.items.doc(foundItemId).get(),
    ]);

    return {
      lostItem: lostDoc.exists ? ({ ...lostDoc.data(), id: lostDoc.id } as Item) : null,
      foundItem: foundDoc.exists ? ({ ...foundDoc.data(), id: foundDoc.id } as Item) : null,
    };
  }

  async loadPairForInitiate(
    lostItemId: string,
    foundItemId: string,
  ): Promise<{ lostItem: Item | null; foundItem: Item | null }> {
    return this.loadSessionItems(lostItemId, foundItemId);
  }

  async updateHandover(matchId: string, data: Record<string, unknown>): Promise<void> {
    await this.handovers.doc(matchId).update(data);
  }

  async listCompleted(): Promise<Array<Record<string, unknown> & { id: string }>> {
    const snapshot = await this.handovers.orderBy('handoverTime', 'desc').get();

    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }

  /**
   * Every completed handover a user took part in, on either side.
   *
   * `participantIds` is written alongside the two person snapshots precisely so
   * this can be one indexed query. Records written before that field existed do
   * not match it, so a second filtered pass picks them up until
   * `npm run migrate:handovers` has run and the settings flag says so; that
   * pass is the full scan this method used to do on every request.
   */
  async listCompletedForUser(
    userId: string,
    { backfilled = false }: { backfilled?: boolean } = {},
  ): Promise<Array<Record<string, unknown> & { id: string }>> {
    const indexed = await this.handovers
      .where('participantIds', 'array-contains', userId)
      .get()
      .then((snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })))
      .catch((error) => {
        // The composite index ships in `firestore.indexes.json` but is only
        // live once `firebase deploy` has run.
        log.warn('Indexed handover lookup failed, falling back to a scan', { error });
        return null;
      });

    // The migration has run, so every record carries the field and the indexed
    // query is the whole answer. This is the state PERF-03 exists to reach.
    if (indexed !== null && backfilled) return sortByCompleted(indexed);

    // The index is missing, so the scan is the only source: it must return
    // everything the user took part in, new records included.
    if (indexed === null) {
      return sortByCompleted(await this.listLegacyForUser(userId, { includeBackfilled: true }));
    }

    const legacy = await this.listLegacyForUser(userId, { includeBackfilled: false });
    const seen = new Set(indexed.map((record) => record.id));

    return sortByCompleted([...indexed, ...legacy.filter((record) => !seen.has(record.id))]);
  }

  /**
   * The pre-`participantIds` path: read the completed handovers and filter on
   * the nested person snapshots. Bounded by `status`, which is at least one
   * equality filter rather than the whole collection.
   *
   * `includeBackfilled` is the difference between the two callers. Alongside a
   * working indexed query this must skip records that query already returned;
   * as a standalone fallback it is the only source and must return them.
   */
  private async listLegacyForUser(
    userId: string,
    { includeBackfilled }: { includeBackfilled: boolean },
  ): Promise<Array<Record<string, unknown> & { id: string }>> {
    const snapshot = await this.handovers.where('status', '==', 'completed').get();

    return snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }))
      .filter((handover) => {
        const record = handover as {
          participantIds?: string[];
          lostPersonDetails?: { userId?: string };
          foundPersonDetails?: { userId?: string };
        };

        if (record.participantIds) {
          return includeBackfilled && record.participantIds.includes(userId);
        }

        return (
          record.lostPersonDetails?.userId === userId ||
          record.foundPersonDetails?.userId === userId
        );
      });
  }
}

/** Newest first. `completedAt` is the older field name and some records carry only that one. */
function sortByCompleted<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.sort((a, b) => completedMillis(b) - completedMillis(a));
}

function completedMillis(handover: Record<string, unknown>): number {
  const value = (handover.completedAt ?? handover.handoverTime) as
    { toDate?: () => Date } | undefined;

  return value?.toDate?.().getTime() ?? 0;
}

export const handoverRepository = new HandoverRepository();
