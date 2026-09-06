# ADR 0004: CPU ONNX embeddings in-process, not a hosted embedding API

## Status

Proposed. Phase 22.

## Context

ADR 0002 needs a vector per item, computed once at ingest. The target
deployment is a CPU box with no GPU, and the budget for retrieval is under
100 ms end to end, which rules out a network hop to an embedding API on the hot
path.

There is already an unused embedding client in the repository: `utils/embeddings.ts`
implemented a full client and a cosine similarity function, and its only caller
built the string, logged it and threw it away. It was deleted in phase 18. The
lesson worth carrying is that an embedding client is not the hard part.

## Decision

Run the embedding models in-process with ONNX Runtime in Node, behind an
`EmbeddingProvider` port so the implementation can move to a sidecar without a
caller changing.

| Concern      | Choice                                                                | Why                                                                                          |
| ------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Runtime      | ONNX Runtime in-process                                               | The API and matching are already Node. No network hop, no second deploy unit                 |
| Text model   | A small sentence encoder in the 384-dimension class                   | 20 to 35 M parameters, tens of milliseconds per text on CPU, 15 MB of vectors at 10k items   |
| Quantization | int8 dynamic                                                          | Roughly 3 to 4 times faster for about 1 percent quality loss. Measure both before committing |
| Image model  | A compact CLIP-class image encoder, int8 ONNX                         | A real visual embedding instead of concept overlap. Computed at upload, never at query time  |
| Batching     | In the worker, never in the request path                              | Amortizes per-call overhead                                                                  |
| Threading    | Pin the ONNX and OpenMP thread counts to the container CPU allocation | Thread oversubscription is the usual cause of slow CPU inference in containers               |
| Storage      | Persist the vector on the item document at ingest                     | An item is embedded once in its lifetime                                                     |
| Cache        | Content-hash keyed cache in Redis                                     | A re-upload or an edit does not re-embed                                                     |

Every model choice above is validated on the evaluation harness before
adoption. No model is swapped on reputation.

## Consequences

- No per-item cost and no rate limit on the busiest operation in the system.
- No data leaves the deployment for embedding, which is the right default for
  text describing someone's lost property.
- Model files ship with the image, so the image is larger and a model change is
  a deploy.
- Cold start grows by the model load. Load lazily and keep the process warm.
- The same reasoning applies to the vision service, which loads a medium YOLO
  checkpoint today. A nano or small variant exported to ONNX, with frame
  sampling instead of every frame, is the difference between a CCTV feature
  that works on a CPU box and one that does not.

## Revisit when

- A hosted embedding model beats the local one on the eval set by a margin that
  justifies the latency and the per-item cost.
- Embedding throughput needs more CPU than the API box has, at which point the
  port moves to a sidecar rather than to a vendor.
