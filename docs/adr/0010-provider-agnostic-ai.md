# ADR 0010: A provider-agnostic AI interface with capability routing

## Status

Proposed. Phase 21.

## Context

Provider choice is a switch statement in `utils/llm.ts` with a hardcoded
fallback chain, selected by a single `aiProvider` setting. Consequences that
have already been paid for:

- One slow provider stalls the request that picked it. There is a timeout now,
  but no breaker, so every request keeps choosing the same failing provider.
- The settings type rejected a provider the code supported, so a valid option
  was unreachable from the admin screen.
- The same pairs are scored repeatedly with no cache.
- There is no record of what any of it costs.
- A request needing tool calling or vision only finds out at the provider's
  API.

Adding a provider today means editing the switch, the settings enum, the
fallback chain and the type. That is four edits for something that should be
one file.

## Decision

A small provider framework: ports, a registry, and a router.

```
interface ChatProvider {
  readonly id: string;
  readonly capabilities: { vision: boolean; tools: boolean; jsonSchema: boolean; maxContext: number };
  readonly cost: { inputPerMTok: number; outputPerMTok: number };
  chat(req: ChatRequest): Promise<ChatResponse>;
}

interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

The router owns what is missing today: capability routing, per-task policy,
circuit breaking, a token bucket per provider shared across workers, retry with
jitter on retryable statuses only, a mandatory abort signal, a response cache
keyed on model plus prompt plus parameters, a cost meter with daily and monthly
ceilings, and one span per call.

Configuration moves from one `aiProvider` string to a per-task policy an admin
can edit: `{ task, primary, fallbacks[], model, temperature, maxTokens, timeoutMs, cacheTtl }`.
A cheap model reranks; a stronger one adjudicates.

Adding a provider becomes one new file plus a registry entry, with no caller
changed.

## Consequences

- Failover becomes meaningful rather than nominal, because the breaker stops
  routing to something that is failing.
- Cost becomes visible and boundable, which is the difference between an
  experiment and a service.
- A local runtime for development means no key and no spend to run the system.
- The cost is a layer of indirection over what is otherwise an HTTP call, and a
  registry that has to be kept honest about model identifiers and pricing.
  Confirm both at implementation time rather than hardcoding them from memory.

## Revisit when

- Only one provider is ever used in practice, in which case the registry is
  ceremony and the router alone earns its keep.
- A hosted gateway offers the same routing, caching and metering at a price
  worth the dependency.
