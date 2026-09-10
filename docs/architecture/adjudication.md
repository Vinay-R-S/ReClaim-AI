# The adjudication agent

Stage 3 of the matching pipeline. Built in phase 25, from PLAN.md section 8.6.

## What the stage before it cannot do

Reranking compares the text two people happened to write. That is most of the
signal and it is not all of it. It cannot go and check whether the photographs
look like the same object, whether the two places are half a kilometre or
fourteen apart, whether the found report is dated before the loss it is
supposed to answer, or whether the person filing has filed nine claims this
week.

Those are lookups, not judgements, and an agent is the right shape for them:
decide what to check, check it, decide what the answer means, and stop.

## When it runs

Only on the single best pair of a run, and only when that pair's normalised
score falls inside the uncertainty band.

| Score band                | What happens                             | Cost         |
| ------------------------- | ---------------------------------------- | ------------ |
| At or above `BAND_HIGH`   | Confirmed on the deterministic evidence  | Nothing      |
| `BAND_LOW` to `BAND_HIGH` | Adjudicated                              | One agent run |
| Below `BAND_LOW`          | Discarded on the deterministic evidence  | Nothing      |

That is the whole cost control. A pair above the band was going to be confirmed
anyway and a pair below it discarded anyway, so paying a model to have an
opinion about either is paying for a decision already made.

The defaults are 60 and 85. The match threshold is 55, so with the defaults the
agent can only ever take a pair *out* of the matched set or hold it for a
person. Lowering `ADJUDICATION_BAND_LOW` below 55 lets it surface a pair the
deterministic scorer rejected, as a record for an admin rather than as a
handover: see the guards below.

## The tools

Six, five of which are deterministic reads and cost one Firestore read or none.

| Tool                | Answers                                                     |
| ------------------- | ----------------------------------------------------------- |
| `get_item`          | The full stored report for an id                            |
| `compare_images`    | Cosine between the two stored image vectors                 |
| `geo_distance`      | Kilometres between the two coordinate pairs                 |
| `time_delta`        | Hours apart, and which report came first                    |
| `search_similar`    | Other reports resembling a description                      |
| `get_claim_history` | How much the reporter of one of the two reports has filed, as counts and nothing else |

`compare_images` uses the vector computed at ingest rather than a vision call:
it is the same signal retrieval already ranks on, it is arithmetic on two
arrays, and a second opinion from a different model would be on a different
scale.

`search_similar` is the one that answers a question a score cannot. A pair that
looks strong in isolation and sits in a crowd of nine identical black umbrellas
is a pair to hand to a person.

### What a tool may not do

Write. Nothing here mutates anything, and the agent has no path to a write even
by accident.

Reach outside the pair. `get_item` answers only for the two items being
adjudicated plus whatever `search_similar` surfaced during this run.
`get_claim_history` is narrower still: it takes an *item* id, and only one of
the two being adjudicated. It resolves the reporter itself and answers in
counts, so no user id is ever put in front of a model and a report surfaced by
search — which belongs to a third party who is not part of this decision — is
refused. Without those allowlists an agent whose prompt had been steered by an
attacker-written description would be a user enumeration endpoint that answers
in natural language.

Surface what a moderator removed. The vector index filters on type and status
only, and a rejected report keeps its `Pending` status and its vector, so
`search_similar` applies the moderation filter the rest of the pipeline applies.
Without it a rejected report could be surfaced, allowlisted, read in full, and
copied into a match document belonging to two unrelated people.

Return raw untrusted text. Every item field a tool returns goes through the
same sanitiser and the same per-run nonce fence the reranker uses. A tool result
is the one place where attacker-written text arrives several turns in, after
the transcript has become mostly operator text.

Truncation is fence-aware for the same reason. Field caps are public, so where
a cut lands inside an attacker's own description is attacker-chosen, and a cut
that opens a fence without closing it puts everything after it — the next tool
result header, the final-turn instruction — inside the region the system prompt
says is untrusted. The clamp closes what the cut opened, which makes the balance
a property of the code rather than of arithmetic nobody rechecks when a field
cap changes.

## The loop, and its bounds

Each turn the model returns one schema-constrained object: either a tool call
or a verdict, never both and never neither.

| Bound                         | Default | What happens when it is hit          |
| ----------------------------- | ------- | ------------------------------------ |
| `ADJUDICATION_MAX_TOOL_CALLS` | 8       | Asked once for a verdict from what it has |
| `ADJUDICATION_DEADLINE_MS`    | 20000   | Same                                 |
| One tool call                 | 5000    | The tool refuses and the agent is told    |
| Turns                         | Tool calls + 1 | Run ends with no verdict      |

The deadline is checked between turns, so a run can end one provider timeout
past it. The pipeline that awaits this stage therefore applies a ceiling of its
own: the whole matching run happens inside a `match.item` attempt killed at 120
seconds and retried twice, and retrieval, scoring and rerank have already spent
most of that. A stage that waits unbounded here is a matching run that dead
letters without writing a single match record, which is strictly worse than
never having adjudicated.

A budget that is spent does not abandon the run. The agent is told the budget
is gone and asked to answer from what it has, because a run that gathered five
facts and then timed out silently is five reads and a model bill spent on
nothing. It is asked exactly once; an agent that answers that with another tool
call ends the run.

### Why JSON steps rather than provider tool calling

The `ChatProvider` port has no tool-calling surface, and giving it one means
six adapters, six wire formats for the same idea, and a router reconciling
them, for a stage that runs on one pair occasionally. A schema-constrained step
object costs one field and behaves identically on all six providers, including
the three that cannot constrain output at all and are validated here instead.

The trade: a provider's own tool calling is trained behaviour and this is not,
so a weaker model will sometimes answer with neither a tool nor a verdict. The
router repairs that once; a second failure ends the run with no verdict, which
is the correct outcome and is not a match.

## What deterministic code does with the verdict

The agent returns a recommendation. `adjudication.policy.ts` is the only place
that turns one into an outcome, it is pure, and it is where the rules that hold
whatever the model said are written down.

| Verdict              | Confidence            | Was a match | Outcome           |
| -------------------- | --------------------- | ----------- | ----------------- |
| `match`              | at or above the floor | either      | Confirmed, if the pair also cleared the deterministic threshold and the evidence guards; held for an admin otherwise |
| `no_match`           | at or above the floor | yes         | Discarded         |
| `no_match`           | at or above the floor | no          | Nothing           |
| `needs_human_review` | any                   | yes         | Held for an admin |
| anything             | below the floor       | yes         | Held for an admin |
| anything             | below the floor       | no          | Nothing           |

Four rules make this safe:

A verdict never confirms a pair the deterministic pipeline refused on evidence.
The semantic requirement and the minimum applicable weight are guards against
matching two reports on almost nothing, and section 8.8 is explicit that they
stand whatever the model says. The hard filters on type, distance and time ran
before the agent was called and are not reopened.

A verdict never confirms a pair below the match threshold either. Inside a band
whose lower edge is below the threshold the agent may argue for a pair the
deterministic scorer was not convinced by, and the argument goes to a person:
the record is written and the handover is not started.

A verdict below the confidence floor moves nothing on its own. A confirmation
and a rejection are both decisions, and one made at thirty percent confidence
is one the deterministic score should have kept.

Held for an admin means the match record is written, with the agent's reasoning
on it and `handoverHeld: true`, and the automatic handover does not start. The
handover is the step that emails two people a collection code and cannot be
taken back.

A discard stops the automatic path too, which is the least obvious of the four.
Removing the winner promotes the runner-up, and the runner-up is a pair no agent
looked at that scored lower than the one just rejected. Handing that straight to
an automatic handover would turn "the agent rejected the top pair" into "act on
the next one unexamined".

## What is persisted, and where it is read

The trace goes on the match record: the verdict, the confidence, the evidence
and contradictions the agent listed, every tool call with its arguments and
what the tool answered, the model, the provider, the prompt version, the cost,
and the latency. The transcript is not stored; it is kilobytes of model-written
text per match and everything in it that mattered is already in the steps.

`AdjudicationPanel` renders it in the admin match review modal, next to the two
reports it is about. The point is that an admin verifying a match is otherwise
being asked to trust a number: 71 says nothing, while "the photographs score
0.31 against each other and the reports are 12 km apart" is a reason, and it is
checkable against the two reports on the same screen.

## Rolling it out

`ADJUDICATION_MODE` defaults to `shadow`, like the two stages before it. In
shadow the agent runs, the trace is stored, the panel shows it with a banner
saying it changed nothing, and no outcome moves. That is what makes the numbers
readable before anything depends on them: agreement with the deterministic
answer, how often it says `needs_human_review`, cost and latency per run, and
how many pairs fall in the band at all.

Turning it on is a decision to be made from those numbers.
