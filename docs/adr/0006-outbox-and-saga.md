# ADR 0006: Outbox plus saga with compensations

## Status

Proposed. Phase 20 for the outbox, phase 26 for the handover saga.

## Context

Handover completion has five side effects: item status on two documents, match
archival, credit awards, the emails, and the chain write. Four of them are one
Firestore batch today, which is genuinely atomic. The emails and the chain
write are outside it and are fire-and-forget.

That shape has two failure modes. A batch that succeeds followed by an email
that fails leaves a completed handover nobody was told about, with no record
that the message is owed. And anything that has to reach across the process
boundary, matching for example, has no durability at all: if the process dies,
the intent dies with it.

Two-phase commit is not available. Firestore has no distributed transaction
manager and neither does an email provider.

## Decision

The outbox pattern, then a saga for the multi-step flows.

1. The state change and an outbox row are written in the **same** Firestore
   transaction. Nothing else happens inline.
2. A drainer reads outbox rows and dispatches each side effect as its own job
   on the queue from ADR 0005.
3. Each job carries an idempotency key derived from the aggregate and the step,
   for example `(handoverId, step)`, so a replay is safe.
4. Each step declares a compensating action. A failure past the point of no
   return escalates to an admin queue rather than retrying forever.

The compensation table for handover completion is in
[sequences.md](../architecture/sequences.md); the short version is that credits
are corrected with reversing entries and the chain, being append-only, gets a
linked revocation rather than a deletion.

## Consequences

- A side effect can no longer be silently skipped. Either the transaction
  committed, in which case the intent is recorded, or it did not, in which case
  nothing happened.
- Every consumer must be idempotent. That is a real constraint on every job
  written from here on, and the idempotency key is what makes it mechanical
  rather than a matter of care.
- The system becomes eventually consistent in places it is immediately
  consistent today. A handover completes and the email arrives a moment later;
  the UI has to say "sent" rather than assert it.
- More moving parts to observe. The dead-letter queue and the outbox lag are
  the two numbers that matter, and both need to be visible.

## Revisit when

- Outbox lag under normal load is routinely above a few seconds, which would
  mean the drainer needs a different trigger than polling.
- A step turns out to have no meaningful compensation, which is a sign it
  should be moved before the point of no return rather than compensated after
  it.
