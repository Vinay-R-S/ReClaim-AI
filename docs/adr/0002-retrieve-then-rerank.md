# ADR 0002: Two-stage retrieve then rerank, not an LLM call per candidate

## Status

Accepted, 2026-09-07. Implemented in stages across phases 22 to 25.

## Context

Matching today loads every pending item of the opposite type and sends one LLM
prompt per surviving candidate asking for a similarity score. There are no
vectors and no nearest-neighbour search anywhere in the system: a linear scan
with an LLM in the inner loop.

The arithmetic is the argument. At 10,000 active items, one call per candidate
is up to 10,000 LLM calls per report. The cost and the latency both grow with
the corpus, and the corpus is the thing that is supposed to grow.

Two further consequences of the same shape. Scores are non-deterministic, so
the same pair can match on one run and not the next. And there is no stage
cheap enough to run over everything, so a hard tag-overlap gate exists purely
to keep the candidate count down; that gate is the single biggest cause of
missed matches, because it drops a true pair on exact token overlap before any
semantic stage runs.

## Decision

Four stages, each narrower and more expensive than the last.

| Stage        | Method                                                               | In  | Out                   | Budget                 |
| ------------ | -------------------------------------------------------------------- | --- | --------------------- | ---------------------- |
| 0 Filter     | Firestore query: opposite type, open status, time window, geo bounds | All | 50 to 500             | Under 50 ms            |
| 1 Retrieve   | Hybrid dense KNN plus lexical, fused with reciprocal rank fusion     | 500 | Top 20                | Under 100 ms, CPU only |
| 2 Rerank     | One batched LLM call scoring all 20 pairs                            | 20  | Top 3 above threshold | 1 to 2 s, one call     |
| 3 Adjudicate | Tool-using agent on the top pair, structured verdict                 | 3   | 0 or 1                | 3 to 5 s, one run      |

Stage 3 runs only inside an uncertainty band, roughly 60 to 85. Above it a
match auto-confirms, below it the candidate is discarded, so the expensive step
stays rare.

Retrieval is hybrid rather than purely dense because lost-and-found text is
short and full of proper nouns. Dense vectors handle "Apple phone" against
"iPhone 13"; lexical search handles a serial number or a name written inside a
bag, which an embedding model blurs. Fuse them rather than choosing.

The hard tag gate is deleted, not tuned.

## Consequences

- O(N) LLM calls becomes O(1): one or two per report instead of thousands.
- Recall comes from retrieval and precision from reranking, which is the
  standard division of labour and lets each be measured separately.
- Retrieval needs embeddings, which is ADR 0004, and an index, which is
  ADR 0003. This decision is the reason both exist.
- Nothing can be claimed about quality without an evaluation harness. That is
  part of the same work, not a follow-up: the labelled set and the offline
  metrics land with the reranker.
- Rollout is shadow mode first. Run the new pipeline beside the old, log both,
  act on neither, and compare on real traffic before switching.

## Revisit when

- Recall@10 on the labelled set stays below 0.90 after tuning retrieval, which
  would mean the filter stage is dropping true pairs.
- A local cross-encoder measurably beats the batched LLM rerank on the eval set
  at lower cost, which would take the LLM out of stage 2 entirely.
