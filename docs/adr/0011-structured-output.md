# ADR 0011: Structured output and deterministic guards, never model prose

## Status

Partly accepted. The digit-stripping parser and the deterministic guard are
done (phase 8); schema-constrained responses and prompt delimiting are phases
24 and 25.

## Context

The matching score was read out of free text by stripping every non-digit
character and parsing what was left. A reply of "85/100" became 85100, clamped
to a perfect 100. So did "I rate this 7 out of 10". Any model that did not
answer with a bare number produced a false maximum, which was enough to
auto-match two unrelated reports and email two strangers a handover code.

The same surface has a second problem. Item name, description and tags are
attacker-controlled and are interpolated straight into the scoring prompt with
no delimiting and no instruction hierarchy, so a reporter can write
instructions into their own description and influence the score on their own
item (defect AI-02).

## Decision

Never accept free text as a decision.

- Use structured output, JSON schema or tool calling, and validate the parsed
  object before use. A score must be an integer 0 to 100; a verdict must be an
  enum member. Reject and retry once, then fail closed.
- Delimit and label untrusted content explicitly in every prompt, and instruct
  the model that content inside the delimiters is data and never instructions.
- Strip or neutralize instruction-like patterns in stored text before it
  reaches a prompt, and log when that fires: it is an abuse signal as much as a
  safety control.
- Keep a deterministic guard **outside** the model. A match may not
  auto-confirm unless the hard filters on distance, time and type also pass,
  whatever the model says.
- The same rules apply in full to any chat assistant, where the injection
  surface is larger.

What is already true: the digit-stripping parse is gone, a fraction is read as
a fraction, anything above 100 is rejected, and a match additionally requires a
semantic verdict plus at least 65 of the 100 available weight. The model can no
longer confirm a match on its own.

## Consequences

- A garbled or hostile reply fails closed instead of producing a maximum score.
- The deterministic guard means the worst a successful injection can do is
  raise a score, not bypass the distance and time rules that actually protect
  the property.
- Structured output support varies by provider, so the translation belongs in
  the provider adapter (ADR 0010), not at the call site.
- Retrying once on a schema violation costs a call. That is cheaper than one
  wrong handover.

## Revisit when

- A provider's structured output proves unreliable enough that a constrained
  decoder or a local model is the better guarantee.
