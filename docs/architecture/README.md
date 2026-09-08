# Architecture

The design documents for ReClaim AI, kept next to the code so they can be
reviewed in the same pull request as the change they describe.

## What is here

| Document                                         | Covers                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [C4 level 1, context](c4-context.md)             | The system, the people who use it, and the third parties it depends on                  |
| [C4 level 2, container](c4-container.md)         | Client, API, worker, queue, stores, inference, and the request path through them        |
| [C4 level 3, component](c4-components.md)        | The insides of matching, handover and the ledger, plus the module boundaries            |
| [Sequences](sequences.md)                        | Report to match, match to handover to completion, revert, chat with moderation          |
| [State machines](state-machines.md)              | Handover, item lifecycle, custody                                                       |
| [Data model](data-model.md)                      | Every collection, its fields, its indexes, and the access pattern each index exists for |
| [Deployment](deployment.md)                      | Environments, network boundaries, and how a secret reaches a process                    |
| [Requirements and capacity](nfr-and-capacity.md) | The numbers the design is accountable to, and the arithmetic behind the sizing          |
| [ADRs](../adr/README.md)                         | The decisions, why they were taken, and what would reverse them                         |
| [API contract](../api/README.md)                 | OpenAPI 3.1 for the HTTP surface, and the versioning policy                             |

## How to read a diagram here

These documents describe a system that is partly built. Mixing the two without
saying which is which is how a design document becomes fiction, so every
diagram marks its elements:

- **Solid boxes, no marker.** Exists today and is exercised by the running
  application.
- **Dashed boxes, marked `(planned)`.** Designed, not built. The phase that
  builds it is named in the text under the diagram.

Nothing here is aspirational without a label. If a document says the system
does something, it does it today.

## Conventions

- Diagrams are Mermaid in Markdown, so they render on GitHub and diff as text.
  No binary exports, no external diagramming tool.
- A diagram never carries information that is not also in prose. The prose is
  the contract; the picture is the summary.
- Interfaces are named as they are in the code (`VectorIndex`, `ChatProvider`),
  so a reader can grep for them.
- Collection names are the real Firestore paths.

## Where this came from

`PLAN.md` sections 7, 16 and 17 hold the analysis and the decisions. These
documents are those sections turned into artifacts that live with the code:
the analysis stays in the plan, the design lives here. Where the two disagree,
the code and these documents are right and the plan is stale.
