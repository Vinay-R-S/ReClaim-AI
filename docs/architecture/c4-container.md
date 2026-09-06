# C4 level 2, containers

The deployable and runnable pieces. Dashed boxes marked `(planned)` do not
exist yet; the phase that introduces each one is named below the diagram.

```mermaid
flowchart TB
    subgraph browser["Browser"]
        client["Web client<br/>React 18, Vite, static hosting"]
    end

    subgraph runtime["Application"]
        api["API<br/>Node 20, Express, modular monolith"]
        worker["Worker (planned)<br/>same image, different entrypoint"]
    end

    subgraph data["State"]
        firestore[("Firestore<br/>items, users, matches, handovers, ledger")]
        redis[("Redis (planned)<br/>queues, cache, rate buckets")]
        vectors[("Vector index (planned)<br/>Firestore native, behind VectorIndex")]
    end

    subgraph external["External"]
        cloudinary["Cloudinary"]
        llm["LLM gateway<br/>Groq, Gemini, Grok"]
        onnx["ONNX embeddings (planned)<br/>in-process, CPU"]
        yolo["Vision service<br/>Flask, YOLOv11"]
        email["Resend, SMTP"]
        chain["Sepolia"]
    end

    client -->|"HTTPS, Firebase ID token"| api
    client -->|"auth, a few admin reads"| firestore

    api --> firestore
    api --> cloudinary
    api --> llm
    api --> yolo
    api --> email
    api --> chain
    api -.-> redis

    worker -.-> firestore
    worker -.-> redis
    worker -.-> llm
    worker -.-> onnx
    worker -.-> email
    worker -.-> chain
    onnx -.-> vectors
    api -.-> vectors

    classDef planned stroke-dasharray: 5 5
    class worker,redis,vectors,onnx planned
```

## What each container is for

| Container       | Runtime                                                    | Responsibility                                                                                           | Status                                                                                 |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Web client      | React 18, Vite, static hosting                             | UI and the PWA shell. Every write goes through the API; the browser holds no business rules              | Built                                                                                  |
| API             | Node 20, Express, modular monolith                         | HTTP, authentication, validation, orchestration. Matching, email and chain writes currently run here too | Built                                                                                  |
| Worker          | Node 20, same image, different entrypoint                  | Matching, embeddings, email, chain writes, outbox drain. Nothing that blocks a request                   | Planned, phase 20                                                                      |
| Queue and cache | Redis, managed                                             | BullMQ queues, rate-limit buckets, LLM and embedding cache                                               | Planned, phase 20                                                                      |
| Primary store   | Firestore                                                  | Every document. Also the transaction boundary                                                            | Built                                                                                  |
| Vector index    | Firestore native vector search behind a `VectorIndex` port | Dense retrieval over item embeddings                                                                     | Planned, phase 23. See [ADR 003](../adr/0003-vector-index.md)                          |
| Object store    | Cloudinary                                                 | Item images and derived thumbnails                                                                       | Built                                                                                  |
| Inference       | ONNX Runtime in-process                                    | Text and image embeddings on CPU                                                                         | Planned, phase 22. See [ADR 004](../adr/0004-cpu-onnx-embeddings.md)                   |
| Vision service  | Python Flask and YOLOv11                                   | CCTV object detection only. Token-authenticated, refuses every request without `YOLO_SERVICE_TOKEN`      | Built                                                                                  |
| LLM gateway     | Internal module, multi-provider                            | Rerank, adjudication, enrichment. Today a switch statement with a fallback chain                         | Partly built. Phase 21 replaces it. See [ADR 010](../adr/0010-provider-agnostic-ai.md) |
| Chain           | Ethers and Sepolia                                         | Handover attestation. Optional, best effort                                                              | Built, off by default                                                                  |

The API and the worker ship from the same image with different entrypoints, so
their dependencies and their code cannot drift apart.

## The request path today

A report is filed and everything else happens before the response returns:

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as API
    participant F as Firestore
    participant L as LLM
    participant M as Email

    C->>A: POST /api/v1/items
    A->>A: validate, authorize, sanitize
    A->>F: create item, status Pending, moderation pending
    A-->>C: 201 Created
    Note over A: matching runs after the response,<br/>in the same process
    A->>F: load pending items of the opposite type
    loop every surviving candidate
        A->>L: score this pair
    end
    A->>F: write match, move both items to Matched
    A->>M: handover code and link
```

Two properties of that path are the reason for most of Track B. The LLM is
called once per candidate, so cost and latency grow with the corpus. And the
work after the response has no durability: if the process restarts mid-way, the
report exists and nothing else does, with no record that matching was owed.

## The request path after phase 20

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as API
    participant F as Firestore
    participant Q as Redis queue
    participant W as Worker

    C->>A: POST /api/v1/items
    A->>F: create item and outbox row in ONE transaction
    A-->>C: 201 Created
    F-->>W: outbox drain
    W->>Q: enqueue embed.item
    W->>Q: enqueue match.candidates
    Note over W: each job is durable, retried,<br/>and dead-lettered on give-up
    W->>Q: enqueue handover.initiate for the one confirmed pair
    W->>Q: enqueue notify.*
```

The transaction is what makes it reliable: the item and the intent to match it
are committed together, so matching cannot be silently skipped, and a matching
failure cannot fail a report that is already saved.

## Cross-cutting concerns

| Concern         | Where it lives today                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication  | `auth.middleware.ts`. Verifies the Firebase ID token, then resolves the role from Firestore, never from the token or the body                          |
| Authorization   | `role.middleware.ts`. `requireAdmin`, `requireActiveUser`, `requireOwnership`                                                                          |
| Validation      | `validation.middleware.ts` with zod schemas in `schemas/`. Every mutating route validates and the parsed value replaces the raw one                    |
| Errors          | `errorHandler.middleware.ts`. `AppError` carries the status and optional details; a deliberate 4xx keeps its message, a 5xx is sanitized in production |
| Rate limiting   | `rateLimit.middleware.ts`. Per-surface budgets: the API as a whole, AI routes, item creation, handover verify and status, credentials                  |
| Logging         | `utils/logger.ts`. The only logging entry point. Redacts identifiers, drops stack traces in production                                                 |
| Correlation ids | Not yet. Planned with the worker in phase 20                                                                                                           |
