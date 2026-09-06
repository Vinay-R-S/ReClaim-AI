# ADR 0005: A Redis-backed job queue, not a Firestore-polling job table

## Status

Proposed. Phase 20.

## Context

Everything that should be a background job runs inline today: matching after
the item response, emails during handover completion, the chain write. There is
no retry, no dead letter, and no record that work was owed, so a process
restart mid-way loses the work silently.

Two ways to get a queue without adding much:

| Option                           | Pros                                                                                                                                                                       | Cons                                                                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore job collection, polled | No new infrastructure, transactional with the domain write                                                                                                                 | Polling costs reads continuously whether or not there is work, no native delayed jobs or priorities, no mature tooling, and building retry and backoff by hand is exactly the code most likely to be subtly wrong |
| Redis with BullMQ                | Blocking pop so idle costs nothing, retries with backoff and jitter, delayed and repeatable jobs, dead-letter queues, rate limiting, concurrency control, an inspection UI | A new managed dependency, and the queue is not in the same transaction as the domain write                                                                                                                        |

The second cost is the one that matters, and it is what the outbox in ADR 0006
exists to solve: the domain write and the outbox row commit together in
Firestore, and a drainer moves outbox rows to Redis. The queue never has to be
transactional with the database because the outbox already is.

## Decision

Redis with BullMQ for the worker tier. Firestore keeps the outbox; Redis
carries the jobs.

- Queues per concern: `embed`, `match`, `handover`, `notify`, `chain`.
- Every job carries an idempotency key, because at-least-once delivery means a
  job will run twice eventually.
- Exponential backoff with jitter, a bounded attempt budget, then a dead-letter
  queue that an admin can see and replay.
- Redis also carries the rate-limit buckets and the LLM and embedding caches,
  which is the second and third reason to have it.

## Consequences

- One more managed service to provision, secure and pay for, and a hard
  dependency: with Redis down, no background work runs. Jobs are not lost,
  because the outbox rows are still in Firestore, but nothing drains.
- Redis is not the source of truth for anything. Losing it entirely loses queue
  state, not domain state, and the outbox refills it.
- Local development needs a Redis, which is one container in the compose file.

## Revisit when

- The queue is the only reason Redis exists and the job volume stays trivially
  low, where a Firestore-polling table would be cheaper than a managed
  instance.
- Job volume or fan-out outgrows a single Redis, which at the projected 200
  reports per day is far away.
