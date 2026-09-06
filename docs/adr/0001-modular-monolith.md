# ADR 0001: A modular monolith, not microservices

## Status

Accepted, 2026-09-07.

## Context

The system has one API process doing HTTP, matching, embedding, email and chain
writes. Track B adds a worker tier, a vector index, a chat module and an
inventory module, which is the point where the question of splitting into
services becomes real rather than theoretical.

The forces:

- The domain is small. Ten modules, of which three are substantial.
- The team is one person.
- Firestore transactions do not span services, and the two operations that most
  need atomicity, handover completion and a credit award, both cross what would
  become service boundaries.
- The failure mode that actually hurts today is not "one service is slow", it
  is "one process does slow work inside a request".

## Decision

Keep one deployable API and one deployable worker, both from the same image.
Enforce module boundaries in code instead of over the network:

- Each module owns its repositories and exposes a service interface.
- A cross-module call goes through that interface. No module reaches into
  another module's repository.
- A lint rule enforces the boundary, so a later split stays possible.

The boundaries are the ones in
[c4-components.md](../architecture/c4-components.md): identity, catalog,
matching, handover, ledger, inventory, messaging, notification, intelligence,
platform.

## Consequences

- The thing that fixes latency is the worker tier, not the split, and this
  decision keeps that work cheap.
- Transactions stay available across what would otherwise be service
  boundaries. Handover completion remains one batch.
- One deploy, one log stream, one set of credentials. Nothing to trace across a
  network to debug a request.
- The cost is discipline. Module boundaries that are only conventions decay,
  which is why the lint rule is part of the decision rather than a follow-up.
- Scaling is coarse: the whole API scales together. At this size that is
  cheaper than the alternative.

## Revisit when

- Two modules need genuinely different scaling profiles for a sustained period,
  not a spike.
- The team is large enough that deploy contention is a real cost, which for
  this codebase means more than one team owning parts of it.
- A module needs a runtime this one cannot host, which here most plausibly
  means a Python inference service that outgrows a sidecar.
