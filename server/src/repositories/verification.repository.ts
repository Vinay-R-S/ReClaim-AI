/**
 * Verification persistence.
 */

import { collections, db } from '../utils/firebase-admin.js';
import type { Verification } from '../types/index.js';

export class VerificationRepository {
  constructor(
    private readonly verifications = collections.verifications,
    private readonly firestore = db,
  ) {}

  ref(id: string): FirebaseFirestore.DocumentReference {
    return this.verifications.doc(id);
  }

  async findById(id: string): Promise<Verification | null> {
    const doc = await this.verifications.doc(id).get();

    if (!doc.exists) return null;

    return { ...doc.data(), id: doc.id } as Verification;
  }

  async create(data: Omit<Verification, 'id'>): Promise<string> {
    const ref = await this.verifications.add(data);

    return ref.id;
  }

  /**
   * The attempt counter has to move in its own transaction, before the model
   * call, or the cap means nothing under concurrency.
   */
  runTransaction<T>(fn: (tx: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
    return this.firestore.runTransaction(fn);
  }

  async listForItem(itemId: string): Promise<Verification[]> {
    const snapshot = await this.verifications
      .where('itemId', '==', itemId)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as Verification);
  }
}

export const verificationRepository = new VerificationRepository();
