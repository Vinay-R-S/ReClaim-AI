# ADR 0012: Firestore stays the primary store

## Status

Accepted, 2026-09-07.

## Context

Track B adds an outbox, an event log, a ledger, chat and inventory. Each is a
shape a relational store handles well, which makes "should this move to
Postgres" a fair question to ask once, in writing, rather than repeatedly in
passing.

What Firestore is giving the project today:

- Auth, the database and the security rules are one product with one identity
  model. The rules are the browser's access control and they are tested against
  the emulator in CI.
- Realtime listeners, which is the whole transport story for chat (ADR 0008).
- Transactions and batched writes within the database, which is what makes
  handover completion and the credit ledger correct.
- No servers to run, patch or back up.

What it costs:

- No joins, so anything relational is a denormalization plus the discipline to
  keep it consistent. `participantIds` on handovers is exactly that.
- Composite indexes must be declared ahead of every query shape, and an
  undeclared one fails at runtime rather than at build time.
- Aggregation is limited. Counting needs an aggregation query or a maintained
  counter; there is no `GROUP BY`.
- Query expressiveness is narrow enough that some filtering happens in memory,
  which is why `moderation` is filtered after the fetch.

## Decision

Firestore remains the primary store for every collection, including the outbox,
the event log and the ledger. Redis is added as infrastructure (ADR 0005) and
holds no source of truth.

The postponed alternative is Postgres, which would buy joins, richer
aggregation, `pgvector`, and a transactional outbox in the same engine as the
queue. It would cost the rules, the listeners, the emulator workflow, and a
full data migration.

## Consequences

- Reporting and analytics have to be precomputed by scheduled jobs into a
  `stats` collection. Dashboards read the aggregate, never the raw collection.
- Every new query shape is also an index entry, and deploying it is an
  operational step somebody has to remember.
- The vector index question stays inside Firestore for now (ADR 0003).
- Denormalizations need a migration and a fallback for records written before
  it, which is a pattern this project has now run three times.

## Revisit when

- Analytics needs ad-hoc multi-dimensional queries rather than precomputed
  aggregates, which is the classic reason to add a warehouse rather than
  replace the store.
- Multi-tenancy arrives with per-tenant isolation requirements that rules
  cannot express cleanly.
- Index management or in-memory filtering becomes a recurring source of
  incidents rather than an occasional annoyance.
