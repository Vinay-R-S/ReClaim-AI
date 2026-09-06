# Requirements and capacity

The numbers the design is accountable to, and the arithmetic that decides the
infrastructure. Targets, not measurements: nothing here has been observed in
production yet, and each row names what would measure it.

## Non-functional requirements

| Requirement           | Target                                      | Measured by                                | Status                                                                     |
| --------------------- | ------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| Report submission p95 | Under 400 ms server time                    | API histogram, excluding the client upload | Plausible today: the response returns before matching runs                 |
| Match completion p95  | Under 20 s from submission                  | Job queue timing                           | Not met. Matching is one LLM call per candidate, inline                    |
| Match recall@10       | Above 0.90 on the labelled set              | Offline eval in CI                         | No eval set exists yet                                                     |
| Match precision@1     | Above 0.80                                  | Offline eval in CI                         | No eval set exists yet                                                     |
| Handover verify p95   | Under 300 ms                                | API histogram                              | Plausible: one document get and one transaction                            |
| Chat delivery p95     | Under 1 s                                   | Client-side timing                         | Chat is not built                                                          |
| API availability      | 99.5 percent monthly                        | Uptime probe                               | No probe yet                                                               |
| Ledger correctness    | Balance always equals the sum of the ledger | Nightly reconciliation                     | The transaction makes it true on write. Nothing verifies it after the fact |
| LLM spend             | A hard monthly ceiling, alert at 60 percent | Cost meter per provider                    | No meter. No ceiling                                                       |
| Cold start            | Under 3 s                                   | Deployment probe                           | Not measured                                                               |

The honest summary: the requirements that depend on work already done are
plausible but unmeasured, and every requirement that depends on the worker, the
eval harness or the cost meter is unmet because those do not exist. There is no
observability tier, which is itself the first thing phase 20 needs to fix.

## Where the current design breaks down

| Dimension         | Today                                                       | Breaks at                 | Root cause                                                  |
| ----------------- | ----------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Match latency     | One LLM round trip per candidate, awaited in-process        | About 20 pending items    | O(N) LLM calls                                              |
| Match cost        | N LLM calls per report                                      | Any real traffic          | No retrieval stage, no cache, no cap                        |
| Match quality     | A model verdict plus weighted signals, with no ground truth | Immediately               | No eval set, no metrics                                     |
| Write reliability | Side effects run inline and partially, with no compensation | The first partial failure | No outbox, no saga                                          |
| Read scale        | Cursor-paginated lists and aggregate dashboards             | Comfortable now           | Fixed in phase 16. Was full-collection reads in the browser |
| Availability      | One process does HTTP, matching, email and chain writes     | Any slow dependency       | No worker tier, no bulkheads                                |
| Extensibility     | Provider choice is a switch with a fixed fallback chain     | Adding a fourth provider  | No interface, no registry                                   |

## Capacity model

Assumptions to revise the moment there is real traffic. They are written down
so a later reader can see which number was wrong.

| Quantity                   | Assumption                               | What it implies                                                                                                               |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Active items               | 10,000                                   | 10,000 vectors at 384 dimensions and 4 bytes is about 15 MB. It fits in memory, so a managed vector database is not justified |
| Reports per day            | 200                                      | 200 embedding jobs, 200 retrieval queries                                                                                     |
| Candidates after filters   | 50 on average                            | Retrieval returns the top 20, so 20 pairs reach the reranker                                                                  |
| LLM calls per report       | 1 batched rerank, at most 1 adjudication | 200 to 400 calls per day                                                                                                      |
| Embedding compute          | 200 text and 400 image per day on CPU    | Seconds of CPU per day. Effectively free                                                                                      |
| Firestore reads per report | About 60 with filters and indexes        | Against a full-collection scan today                                                                                          |

The headline is one line of arithmetic. At 10,000 items, one LLM call per
candidate is 10,000 calls per report. Two-stage retrieval makes it one or two.
That is the whole argument for [ADR 002](../adr/0002-retrieve-then-rerank.md),
and it is why the vector index and the embedding model are chosen for the
smallest thing that clears the recall target rather than the best available.

## Cost shape

| Line           | Driver                                 | Control                                                                                                                          |
| -------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| LLM            | Calls per report times tokens per call | Retrieval before reranking, a batched rerank call, a response cache keyed on model plus prompt, and a hard ceiling with an alert |
| Embeddings     | Items times model cost                 | Zero: CPU, in-process, computed once per item and cached on a content hash                                                       |
| Firestore      | Reads per screen and per match run     | Indexes, aggregation queries for counts, field masks, cursor pagination                                                          |
| Cloudinary     | Images times transformations           | Compression in the browser before upload, derived thumbnails                                                                     |
| Vision service | Frames analysed                        | Frame sampling instead of every frame, and a smaller checkpoint                                                                  |

## Frontend budget

| Metric                                            | Budget                           |
| ------------------------------------------------- | -------------------------------- |
| Initial JavaScript, gzipped                       | Under 250 kB for the first route |
| Largest contentful paint on a mid-range phone, 4G | Under 2.5 s                      |
| Interaction to next paint                         | Under 200 ms                     |
| Route chunk                                       | Under 150 kB gzipped             |

The current build splits vendor chunks and lazy-loads every route. What the
landing page actually pulls, measured on the phase 18 build, is 176 kB
gzipped across seven files, of which 66 kB is the Firestore SDK and 53 kB is
React. The two largest chunks in the output, the Excel export at 271 kB and
the chart library at 112 kB gzipped, are not among them: nothing loads either
until an admin opens the screen that needs it.
