# ADR 0003: Firestore native vector search first, behind a `VectorIndex` port

## Status

Accepted. The blocker is resolved: the pinned `firebase-admin@12.7.0`, through
`@google-cloud/firestore@7.11.6`, exposes both `FieldValue.vector()` and
`findNearest()` on a query and a collection reference. Checked in phase 22,
which is why item vectors are stored as native vector values from the start
rather than as arrays that would have needed a full backfill before retrieval
could index them. The retrieval half is phase 23.

## Context

ADR 0002 needs a nearest-neighbour search over item embeddings. The options:

| Option                         | Pros                                                                                                                            | Cons                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Firestore native vector search | No new infrastructure, the same security model, the same transactions, pre-filtering on type, status and time in the same query | Tied to Firestore, index limits, fewer tuning knobs |
| Qdrant self-hosted             | Strong CPU performance, rich payload filtering, HNSW tuning, hybrid built in                                                    | Another service to run, back up and secure          |
| pgvector                       | Good if the system ever moves to Postgres                                                                                       | Implies a full datastore migration                  |
| Managed vector SaaS            | Zero operations                                                                                                                 | Recurring cost, another vendor, data egress         |

The sizing decides it. At 10,000 active items and 384 dimensions at 4 bytes the
entire index is about 15 MB. That is not a scale that justifies a second
datastore, an extra deploy unit, or a vendor.

The pre-filtering point matters more than it looks. The filter stage constrains
by type, status and time, and doing that in the same query as the nearest
neighbour search is the difference between one round trip and fetching a large
candidate set to filter in application code.

## Decision

Use Firestore native vector search, behind a port:

```
interface VectorIndex {
  upsert(id: string, vector: Float32Array, payload: Payload): Promise<void>;
  deleteById(id: string): Promise<void>;
  search(vector: Float32Array, filters: Filters, k: number): Promise<Hit[]>;
}
```

Nothing above the port knows which store is behind it, so a migration is one
new adapter plus a backfill rather than a change to the matching pipeline.

The pinned `firebase-admin` was confirmed to support both before anything was
written to depend on it. Had it not, the same port would have taken a Qdrant
adapter and this record would be superseded rather than the pipeline
redesigned.

## Consequences

- No new infrastructure, and vectors inherit the security rules and the
  transactional guarantees every other field already has.
- Fewer tuning knobs than a dedicated engine. No index parameters to tune, so
  recall is what it is.
- The port is a real cost: an indirection nobody needs on day one. It is worth
  it precisely because the store behind it is the piece most likely to change.
- The lexical half of hybrid retrieval is not solved by this decision. It needs
  either a separate lexical index or an in-process BM25 over the filtered
  candidate set.

## Revisit when

- The corpus passes roughly 100,000 active items, where the index stops being
  something that fits comfortably in memory.
- Retrieval latency exceeds the 100 ms budget at p95.
- Hybrid fusion in application code becomes the bottleneck, which is the point
  where an engine with hybrid built in starts paying for itself.
