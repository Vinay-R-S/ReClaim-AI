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
import type { HandoverCode, HandoverCodeStatus, Item } from '../types/index.js';

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
   * The code document for a match, without the legacy fallback's date reader.
   *
   * The saga runs in a worker, where the caller has no reason to know how a
   * pre-phase-7 document stored its timestamp. Same resolution, one argument.
   */
  async resolveCodeRefById(matchId: string): Promise<DocumentReference> {
    return this.resolveCodeRef(matchId, (value) => {
      const timestamp = value as { toDate?: () => Date } | undefined;

      return timestamp?.toDate?.() ?? null;
    });
  }

  /**
   * Archive the match and write the handover record.
   *
   * What is left of the old `completeHandover` batch after the item writes
   * moved to their own saga step. Still one batch, because these three writes
   * describe a single fact: the match is settled, and here is the record of it.
   *
   * The handover document id is the match id, so a retried step rewrites the
   * same document instead of leaving a second one behind.
   */
  async archiveOnCompletion(write: {
    matchId: string;
    /**
     * The session document, resolved by the caller.
     *
     * Not `codes.doc(matchId)`. A session created before phase 7 lives at a
     * random id, and writing the back-link to the keyed path instead would
     * *create* a stub document there — which `resolveCodeRef` then prefers
     * over the real one, so the handover reads as an open session with no
     * expiry while the real document sits at `verified`. Two documents
     * disagreeing about whether a handover happened is the failure this whole
     * phase exists to remove.
     */
    codeDocRef: DocumentReference;
    record: Record<string, unknown>;
    matchData: Record<string, unknown> | null;
  }): Promise<DocumentReference> {
    const batch = this.firestore.batch();
    const handoverRef = this.handovers.doc(write.matchId);

    batch.set(handoverRef, write.record, { merge: true });
    batch.set(write.codeDocRef, { handoverId: handoverRef.id }, { merge: true });

    // Skipped when the match was synthesized by the verify route and never
    // persisted: there is nothing to archive and nothing to delete.
    if (write.matchData) {
      batch.set(this.matchHistory.doc(write.matchId), {
        ...write.matchData,
        status: 'claimed',
        claimedAt: FieldValue.serverTimestamp(),
        handoverId: handoverRef.id,
      });
      batch.delete(this.matches.doc(write.matchId));
    }

    await batch.commit();

    return handoverRef;
  }

  /** One completed handover, for a revert or a dispute to read. */
  async findCompletedById(matchId: string): Promise<Record<string, unknown> | null> {
    const doc = await this.handovers.doc(matchId).get();

    if (!doc.exists) return null;

    return { ...(doc.data() as Record<string, unknown>), id: doc.id };
  }

  /**
   * A revocation of a chain attestation.
   *
   * Written beside the attestation rather than over it: the chain is
   * append-only, so the honest record of a withdrawn attestation is a second
   * record that references the first, not an absent one.
   */
  async recordChainRevocation(
    matchId: string,
    revocation: {
      revokesTxHash: string;
      reason: string;
      revokedBy: string;
      onChain: boolean;
    },
  ): Promise<void> {
    await this.handovers.doc(matchId).set(
      {
        blockchainRevocation: { ...revocation, revokedAt: FieldValue.serverTimestamp() },
      },
      { merge: true },
    );
  }

  /**
   * Hold the credits awarded for a handover while a dispute is open.
   *
   * A hold, not a reversal. Reversing on a dispute would decide it in advance,
   * and the whole point of `disputed` is that nobody has decided yet. The flag
   * is on the handover record because that is what a revert and a rejection
   * both read; the ledger is untouched, as an append-only ledger must be.
   *
   * Nothing spends credits today, so this is a marker rather than an
   * enforcement point. Phase 28 rewrites the ledger and owns making a hold
   * bind; until then it is what tells an admin, and that phase, which awards
   * are contested.
   */
  async freezeHandoverCredits(matchId: string, actorId: string, reason: string): Promise<void> {
    const ref = this.handovers.doc(matchId);

    // Updated, not merge-set. A merge-set would create a document in the
    // completed-handovers collection for a handover that has none, which is
    // the stub hazard that shadowed legacy sessions in the phase before this.
    // A handover with no record has no credits to hold either.
    await ref
      .update({
        creditsHeld: true,
        creditsHeldReason: reason,
        creditsHeldBy: actorId,
        creditsHeldAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);
  }

  /** Release a hold, when a dispute is rejected or the credits are reversed. */
  async unfreezeHandoverCredits(matchId: string): Promise<void> {
    await this.handovers
      .doc(matchId)
      .update({ creditsHeld: false, creditsReleasedAt: FieldValue.serverTimestamp() })
      .catch(() => undefined);
  }

  /** The chain attestation, once the write has actually landed. */
  async recordChainAttestation(matchId: string, txHash: string): Promise<void> {
    await this.handovers.doc(matchId).set(
      {
        blockchainTxHash: txHash,
        blockchainRecorded: true,
        blockchainRecordedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  /**
   * The sessions an admin may still have to act on.
   *
   * A completed handover moves to the `handovers` collection; what is left
   * here is open, blocked or expired. A blocked session cannot be reopened by
   * anyone but an admin, so it has to be visible somewhere.
   */
  async listOpenSessions(limitPerStatus = 100): Promise<Array<HandoverCode & { id: string }>> {
    // One query per status, each with its own cap. A single `in` query returns
    // document-id order, so once expired sessions outnumber the cap, whether a
    // blocked one appears at all comes down to how its match id sorts. Ordering
    // by date alongside the status filter would need a composite index this
    // deployment does not have; a budget per status does not.
    const statuses: HandoverCodeStatus[] = ['blocked', 'expired', 'pending'];

    const snapshots = await Promise.all(
      statuses.map((status) =>
        this.codes.where('status', '==', status).limit(limitPerStatus).get(),
      ),
    );

    return snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => ({ ...(doc.data() as HandoverCode), id: doc.id })),
    );
  }

  async findCodeByMatch(matchId: string): Promise<HandoverCode | null> {
    const doc = await this.codes.doc(matchId).get();

    if (!doc.exists) return null;

    return doc.data() as HandoverCode;
  }

  /**
   * The session for a match, wherever its document lives.
   *
   * `findCodeByMatch` reads `handoverCodes/{matchId}` and nothing else, so it
   * answers null for a session created before phase 7, whose document carries
   * a random id. Every other path resolves through `resolveCodeRef`, which
   * falls back to a query; a caller that does not would 404 forever on exactly
   * the sessions the fallback exists for.
   */
  async findSessionByMatch(matchId: string): Promise<HandoverCode | null> {
    const ref = await this.resolveCodeRefById(matchId);
    const doc = await ref.get();

    if (!doc.exists) return null;

    return doc.data() as HandoverCode;
  }

  /**
   * Who reported one item.
   *
   * Read from the item rather than from the session, because the session
   * stores ids and not owners, and the question being asked is whether the
   * caller is entitled to act as the owner.
   */
  async ownerOf(itemId: string): Promise<string | null> {
    if (!itemId) return null;

    const doc = await this.items.doc(itemId).get();

    if (!doc.exists) return null;

    const reportedBy = (doc.data() as { reportedBy?: unknown }).reportedBy;

    return typeof reportedBy === 'string' ? reportedBy : null;
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
