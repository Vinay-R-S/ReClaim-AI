# ADR 0007: An append-only ledger, not a mutable balance

## Status

Partly accepted. The ledger and the idempotency key are built (phase 6); policy
as data, reversing entries and reconciliation are phase 28.

## Context

Credits were kept in two places that disagreed: a `credits/{uid}` document and
a `users/{uid}.credits` field, written by different code paths, with a
transaction log that was a record of intent rather than of what happened. A
balance that is edited in place cannot answer "why is it this number", which
is the only question anyone ever asks about a balance.

The system also awards credits from paths that can be replayed. A handover
completion that is retried must not pay twice, and the "check whether a
transaction row exists, then write" pattern races itself under concurrency.

## Decision

One store, and the ledger is the record.

- `creditTransactions` is append-only. Nothing is edited or deleted.
- The idempotency key is the **document id**, so a replay collides on the same
  document inside the transaction rather than racing a read-then-write. Where
  a repeat is a real event, an admin adjustment or a false-claim penalty, no
  key is supplied and the entry gets its own id.
- The entry and the cached balance on `users/{uid}.credits` move in the same
  transaction. The cache exists because every screen shows the balance and
  nobody wants to sum a ledger to render a badge.
- Each entry stores `balanceAfter`, so the history is readable without
  replaying it.

Phase 28 completes the design:

- Corrections are reversing entries carrying `reversalOf`, with `reversedBy`
  set on the original. History stays immutable, which is what makes a dispute
  resolvable.
- `policyVersion` on every entry, and the credit values move out of a
  TypeScript constant into an admin-editable versioned policy document, so a
  historical award stays explainable after the values change.
- A nightly job recomputes every balance from the ledger and alerts on drift.

## Consequences

- A double award is not prevented by a check, it is prevented by the shape of
  the data.
- Every balance is explainable, and the explanation is a query rather than an
  archaeology exercise across logs.
- The cached balance is a denormalization, so it can drift in principle. The
  transaction makes drift impossible on the write path; the nightly job is
  there for everything else, including a manual repair.
- Storage grows forever. At this volume that is not a consideration.

## Revisit when

- The ledger is large enough that computing a balance for reconciliation is
  expensive, which is the point for periodic closing balances rather than a
  full replay.
