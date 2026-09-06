# Architecture decision records

One file per decision. Numbered, and immutable once accepted: a decision that
turns out to be wrong is superseded by a new record, never edited into
agreement with what happened. That is the whole point of keeping them, because
the value of an ADR is in reading what somebody believed at the time.

## Format

Each record has the same five sections.

| Section      | What goes in it                                           |
| ------------ | --------------------------------------------------------- |
| Status       | Proposed, Accepted, Superseded by NNNN. With a date       |
| Context      | The forces. What is true, what is constrained, what hurts |
| Decision     | One sentence of what was decided, then the detail         |
| Consequences | What this costs, including what it makes harder           |
| Revisit when | The observable condition that should reopen it            |

The last section is the one most ADRs leave out and the one that makes them
useful. A decision without a trigger to reconsider it is a decision nobody will
ever revisit, and every choice below is right only for a size and a shape the
system will eventually outgrow.

## The records

| ADR                                     | Decision                                                          | Status          |
| --------------------------------------- | ----------------------------------------------------------------- | --------------- |
| [0001](0001-modular-monolith.md)        | A modular monolith, not microservices                             | Accepted        |
| [0002](0002-retrieve-then-rerank.md)    | Two-stage retrieve then rerank, not an LLM call per candidate     | Accepted        |
| [0003](0003-vector-index.md)            | Firestore native vector search first, behind a `VectorIndex` port | Proposed        |
| [0004](0004-cpu-onnx-embeddings.md)     | CPU ONNX embeddings in-process, not a hosted embedding API        | Proposed        |
| [0005](0005-redis-job-queue.md)         | A Redis-backed job queue, not a Firestore-polling job table       | Proposed        |
| [0006](0006-outbox-and-saga.md)         | Outbox plus saga with compensations                               | Proposed        |
| [0007](0007-double-entry-ledger.md)     | An append-only ledger, not a mutable balance                      | Partly accepted |
| [0008](0008-firestore-chat.md)          | Firestore listeners for chat, not a socket tier                   | Proposed        |
| [0009](0009-event-sourced-handover.md)  | Event-sourced handover state, not field mutation                  | Proposed        |
| [0010](0010-provider-agnostic-ai.md)    | A provider-agnostic AI interface with capability routing          | Proposed        |
| [0011](0011-structured-output.md)       | Structured output and deterministic guards, never model prose     | Partly accepted |
| [0012](0012-firestore-primary-store.md) | Firestore stays the primary store                                 | Accepted        |
| [0013](0013-api-versioning.md)          | A versioned API path with OpenAPI as the contract                 | Accepted        |

"Partly accepted" means the decision is taken and some of it is already in the
code, with the rest scheduled. Each such record says exactly which half is
built.
