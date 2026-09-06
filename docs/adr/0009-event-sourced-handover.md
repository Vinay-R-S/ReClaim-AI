# ADR 0009: Event-sourced handover state, not field mutation

## Status

Proposed. Phase 26.

## Context

Handover state is one field on `handoverCodes/{matchId}`, moved by direct
writes. Two problems follow from that shape.

The first is that an illegal transition is only illegal if some code path
remembers to check. Re-running matching against an existing session used to
rewind a blocked one back to open, handing fresh guesses to whoever was
grinding the code. The current code defends against that with an explicit check
inside the transaction, which works and is exactly the kind of defence that
gets lost in a later refactor.

The second is that a mutated field forgets. There is no record of what the
prior state was, who moved it, or why, so a revert has nothing to restore to
and a dispute has nothing to read.

## Decision

Every transition is an appended event:

```
handoverEvents/{id} = { handoverId, from, to, actor, actorRole, reason, metadata, at }
```

Current state is a projection of the log, and the transition table is data. A
transition that is not in the table cannot be written, so the class of bug
above stops being a thing to remember and becomes a thing that cannot happen.

The states are `initiated`, `code_issued`, `awaiting_meet`, `verified`,
`completed`, `expired`, `cancelled`, `disputed`, `reverted`; the table is in
[state-machines.md](../architecture/state-machines.md).

Only the handover is event-sourced. Items, users and the catalog stay as plain
documents, because their history is either uninteresting or already covered by
an audit collection.

## Consequences

- An audit trail for free, and it is the real one rather than a parallel log
  that can disagree with the state.
- A revert can restore the prior status from the log instead of guessing it,
  which is what makes ADR 0006's compensations honest.
- A dispute has a transcript of the state changes with actors and reasons.
- Reading current state costs more: either replay or a maintained projection.
  Maintain the projection on the handover document and treat the log as the
  source of truth for anything but the hot read.
- Everyone reading this code has to understand that the field is a cache and
  the log is the truth. That is a real onboarding cost and the reason this is
  confined to one aggregate.

## Revisit when

- A second aggregate needs the same treatment, at which point the machinery
  should be extracted rather than copied.
- Projection maintenance turns out to be the source of its own bugs, which
  would argue for replaying on read and caching by version.
