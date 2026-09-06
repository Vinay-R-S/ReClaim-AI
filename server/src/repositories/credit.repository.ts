/**
 * Credit persistence: the balance on `users/{uid}` and the `creditTransactions`
 * ledger that explains it.
 *
 * The two are always written together, in one transaction, which is why the
 * balance lives here rather than on `UserRepository`: a balance without its
 * ledger entry is the defect this pairing exists to prevent (LOG-01).
 */

import { collections, db } from '../utils/firebase-admin.js';

export class CreditRepository {
  constructor(
    private readonly users = collections.users,
    private readonly ledger = collections.creditTransactions,
    private readonly firestore = db,
  ) {}

  userRef(userId: string): FirebaseFirestore.DocumentReference {
    return this.users.doc(userId);
  }

  /**
   * The ledger entry to write.
   *
   * A deterministic id is what makes an award exactly-once: the transaction
   * sees the entry already exists and does not pay it twice.
   */
  ledgerRef(idempotencyKey?: string): FirebaseFirestore.DocumentReference {
    return idempotencyKey ? this.ledger.doc(idempotencyKey) : this.ledger.doc();
  }

  runTransaction<T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(fn);
  }

  historyQuery(userId: string): FirebaseFirestore.Query {
    return this.ledger.where('userId', '==', userId);
  }
}

export const creditRepository = new CreditRepository();
