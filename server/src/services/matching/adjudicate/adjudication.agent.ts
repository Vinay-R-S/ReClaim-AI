/**
 * The adjudication agent.
 *
 * A loop, not a wrapper around a prompt. Each turn the model either calls one
 * tool or returns a verdict, and the loop is what enforces the three bounds
 * section 8.6 asks for: tool calls, wall clock, and turns. When a bound is
 * reached the run is not abandoned — the agent is told the budget is spent and
 * asked for a verdict from what it has, because a run that gathered five facts
 * and then timed out silently is five Firestore reads and a model bill spent
 * on nothing.
 *
 * ## Why the loop is JSON steps rather than provider tool calling
 *
 * Every provider in `platform/ai` speaks the same `ChatProvider` port, and
 * that port has no tool-calling surface. Adding one means six adapters, six
 * different wire formats for the same idea, and a router that has to reconcile
 * them — for a stage that runs on one pair, occasionally. A schema-constrained
 * step object costs one field and works identically on all six, including the
 * three that cannot constrain output at all and are validated here instead.
 *
 * The trade is real and worth naming: a provider's own tool calling is trained
 * behaviour and this is not, so a weaker model will sometimes answer with
 * neither a tool nor a verdict. That is a validation failure, the router
 * repairs it once, and a second failure ends the run with no verdict — which
 * is the correct outcome and not a match.
 *
 * ## What it may do with the answer
 *
 * Nothing. It returns a trace. The pipeline decides, deterministically, and
 * only inside the band; the hard filters on type, distance and time have
 * already run and are not reopened by anything the model says.
 */

import { z } from 'zod';
import { aiRouter, AiRouter, defineStructured } from '../../../platform/ai/index.js';
import { createLogger } from '../../../utils/logger.js';
import { env } from '../../../config/env.js';
import { newFence, sanitise } from '../rerank/rerank.prompt.js';
import { withTimeout } from '../../../utils/async.js';
import {
  AdjudicationTools,
  clampResult,
  TOOL_ARGS_SCHEMA,
  TOOL_NAMES,
  type ToolDependencies,
} from './adjudication.tools.js';
import {
  describePair,
  finalTurnPrompt,
  openingPrompt,
  PROMPT_VERSION,
  systemPrompt,
  toolResultPrompt,
} from './adjudication.prompt.js';
import type {
  Adjudicator,
  AdjudicationRequest,
  AdjudicationStep,
  AdjudicationStop,
  AdjudicationTrace,
  AdjudicationVerdict,
} from './adjudication.types.js';
import type { ChatMessage } from '../../../platform/ai/index.js';

const log = createLogger('matching:adjudicate');

const DECISIONS = ['match', 'no_match', 'needs_human_review'] as const;

/**
 * The one turn beyond the tool budget: the forced final ask.
 *
 * Not two. Once the budget is spent the agent is told so and given exactly one
 * turn to answer; a verdict ends the run and another tool call ends it too, so
 * a second spare turn is a bound the loop can never reach.
 */
const SPARE_TURNS = 1;

/** Longest assistant turn carried forward into the transcript. */
const MAX_ASSISTANT_ECHO = 1000;

/** Ceiling on one tool call, so a slow read cannot outlast the run deadline. */
const TOOL_TIMEOUT_MS = 5_000;

/**
 * One turn: a tool call or a verdict, never both and never neither.
 *
 * The `refine` is the real contract; the JSON Schema below cannot express it,
 * because OpenAI's strict mode requires every property to be listed in
 * `required` and expresses optionality as a nullable type. So the wire shape
 * says "both fields are always present and either may be null" and the zod
 * schema says "exactly one of them is null". A reply that satisfies the first
 * and not the second is repaired once by the router and then fails the run.
 */
export const STEP_SCHEMA = defineStructured({
  name: 'adjudication_step',
  schema: z
    .object({
      reasoning: z.string().max(2000),
      tool: z
        .object({
          // An enum, not a string. The JSON Schema below is a hint on every
          // provider except OpenAI, so this is the only check that always
          // runs, and an unchecked name reaches the transcript verbatim in
          // the refusal that names it.
          name: z.enum(TOOL_NAMES),
          itemId: z.string().max(128).nullish(),
          otherItemId: z.string().max(128).nullish(),
          text: z.string().max(600).nullish(),
          type: z.enum(['Lost', 'Found']).nullish(),
          userId: z.string().max(128).nullish(),
        })
        .nullish(),
      verdict: z
        .object({
          decision: z.enum(DECISIONS),
          confidence: z.number().int().min(0).max(100),
          evidence: z.array(z.string().max(400)).max(12),
          contradictions: z.array(z.string().max(400)).max(12),
        })
        .nullish(),
    })
    .refine((step) => Boolean(step.tool) !== Boolean(step.verdict), {
      message: 'give exactly one of tool or verdict, and set the other to null',
    }),
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['reasoning', 'tool', 'verdict'],
    properties: {
      reasoning: { type: 'string', maxLength: 2000 },
      tool: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['name', 'itemId', 'otherItemId', 'text', 'type', 'userId'],
        properties: {
          name: { type: 'string', enum: [...TOOL_NAMES] },
          itemId: { type: ['string', 'null'], maxLength: 128 },
          otherItemId: { type: ['string', 'null'], maxLength: 128 },
          text: { type: ['string', 'null'], maxLength: 600 },
          type: { type: ['string', 'null'], enum: ['Lost', 'Found', null] },
          userId: { type: ['string', 'null'], maxLength: 128 },
        },
      },
      verdict: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['decision', 'confidence', 'evidence', 'contradictions'],
        properties: {
          decision: { type: 'string', enum: [...DECISIONS] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 400 } },
          contradictions: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', maxLength: 400 },
          },
        },
      },
    },
  },
});

/** Null and undefined both mean "not given"; the tools want one of them. */
function definedArgs(tool: {
  itemId?: string | null;
  otherItemId?: string | null;
  text?: string | null;
  type?: 'Lost' | 'Found' | null;
  userId?: string | null;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      itemId: tool.itemId,
      otherItemId: tool.otherItemId,
      text: tool.text,
      type: tool.type,
      userId: tool.userId,
    }).filter(([, value]) => value !== null && value !== undefined),
  );
}

/** A stable key for "this exact call has already been made". */
function callKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

interface Budget {
  deadline: number;
  maxToolCalls: number;
  maxTurns: number;
}

export class LlmAdjudicator implements Adjudicator {
  constructor(
    private readonly router: AiRouter = aiRouter,
    private readonly tools: ToolDependencies = {},
  ) {}

  async adjudicate(request: AdjudicationRequest): Promise<AdjudicationTrace | null> {
    const started = Date.now();
    const budget: Budget = {
      deadline: started + env.matching.adjudicationDeadlineMs,
      maxToolCalls: env.matching.adjudicationMaxToolCalls,
      maxTurns: env.matching.adjudicationMaxToolCalls + SPARE_TURNS,
    };

    const fence = newFence();
    const tools = new AdjudicationTools(
      request.subject,
      request.subjectType,
      request.candidate,
      fence,
      this.tools,
    );
    const { subjectId, candidateId } = tools.pairIds();
    const candidateParty = tools.party(candidateId);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(fence, budget.maxToolCalls) },
      {
        role: 'user',
        content: openingPrompt(
          {
            subjectId,
            candidateId,
            subjectType: request.subjectType,
            candidateType: candidateParty?.type ?? request.candidate.type,
            pipelineScore: request.pipelineScore,
            bandLow: env.matching.adjudicationBandLow,
            bandHigh: env.matching.adjudicationBandHigh,
          },
          describePair(
            fence,
            { ...request.subject, id: subjectId },
            { ...request.candidate, id: candidateId },
          ),
        ),
      },
    ];

    const steps: AdjudicationStep[] = [];
    const seen = new Set<string>();
    const models = new Set<string>();
    const providers = new Set<string>();

    let toolCalls = 0;
    let modelCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    let forced: 'tool_budget' | 'deadline' | null = null;
    let verdict: AdjudicationVerdict | null = null;
    let stoppedBy: AdjudicationStop = 'verdict';

    for (let turn = 0; turn < budget.maxTurns && !verdict; turn += 1) {
      const exhausted = this.exhausted(budget, toolCalls);

      // Asked once. A second nudge would spend a turn saying the same thing.
      //
      // The deadline bounds tool calls and turns, not the final model call it
      // triggers: that call is bounded by the task policy's own timeout, so a
      // run can end one provider timeout past its deadline. Abandoning the
      // work instead would throw away every fact already gathered.
      if (exhausted && !forced) {
        forced = exhausted;
        messages.push({ role: 'user', content: finalTurnPrompt(exhausted) });
      } else if (exhausted) {
        stoppedBy = exhausted;
        break;
      }

      let step: z.infer<typeof STEP_SCHEMA.schema>;

      try {
        // A copy. The array is appended to on every turn, and handing the
        // router the live one makes what was sent depend on when it is read.
        const answer = await this.router.chatStructured(
          'match.adjudicate',
          { messages: [...messages] },
          STEP_SCHEMA,
        );

        modelCalls += 1;
        models.add(answer.response.model);
        providers.add(answer.response.providerId);
        inputTokens += answer.response.usage?.inputTokens ?? 0;
        outputTokens += answer.response.usage?.outputTokens ?? 0;
        costUsd += answer.response.costUsd;

        step = answer.value;
        // Sanitised, not echoed raw. The model's own turn re-enters the
        // transcript as text outside the fence, which the system prompt
        // defines as operator-authored: a reply that quotes an item's
        // description launders it out of its fence in one hop.
        messages.push({
          role: 'assistant',
          content: sanitise(answer.response.content.slice(0, MAX_ASSISTANT_ECHO)).text,
        });
      } catch (error) {
        // No verdict, and no way to ask for one. The pipeline treats this as
        // "not adjudicated", which leaves the deterministic score standing.
        log.warn('Adjudication step failed', {
          lostItemId: request.subjectType === 'Lost' ? subjectId : candidateId,
          turn,
          error,
        });

        return null;
      }

      if (step.verdict) {
        // The agent writes these from text members of the public typed, and
        // they are persisted and shown to an admin. Sanitising here is what
        // stops a description's structural markers from arriving on a screen
        // with the model's authority attached.
        verdict = {
          decision: step.verdict.decision,
          confidence: step.verdict.confidence,
          evidence: step.verdict.evidence.map((line) => sanitise(line).text),
          contradictions: step.verdict.contradictions.map((line) => sanitise(line).text),
        };
        stoppedBy = forced ?? 'verdict';
        break;
      }

      // `refine` guarantees one of the two, so this is the tool branch.
      const requested = step.tool as NonNullable<typeof step.tool>;

      // Already told the budget was spent and still reaching for a tool. The
      // run ends here rather than granting the call it was refused.
      if (forced) {
        stoppedBy = forced;
        break;
      }

      const parsed = TOOL_ARGS_SCHEMA.safeParse(definedArgs(requested));
      const args = parsed.success ? parsed.data : {};

      toolCalls += 1;

      const key = callKey(requested.name, args as Record<string, unknown>);
      const outcome = seen.has(key)
        ? {
            result: 'You have already made this exact call. Use the answer above.',
            failed: true,
            ms: 0,
          }
        : await this.runTool(tools, requested.name, args, parsed.success);

      seen.add(key);

      const stepRecord: AdjudicationStep = {
        tool: requested.name,
        args: args as Record<string, unknown>,
        result: clampResult(outcome.result, fence),
        ms: outcome.ms,
        ...(outcome.failed ? { failed: true } : {}),
      };

      steps.push(stepRecord);
      messages.push({
        role: 'user',
        content: toolResultPrompt(steps.length, requested.name, stepRecord.result),
      });
    }

    const ms = Date.now() - started;

    if (!verdict) {
      log.warn('Adjudication ended without a verdict', {
        toolCalls,
        modelCalls,
        stoppedBy,
        ms,
      });

      return null;
    }

    return {
      verdict,
      lostItemId: request.subjectType === 'Lost' ? subjectId : candidateId,
      foundItemId: request.subjectType === 'Found' ? subjectId : candidateId,
      pipelineScore: request.pipelineScore,
      steps,
      toolCalls,
      modelCalls,
      stoppedBy,
      promptVersion: PROMPT_VERSION,
      model: [...models].sort().join(','),
      provider: [...providers].sort().join(','),
      inputTokens,
      outputTokens,
      costUsd,
      ms,
      mode: env.matching.adjudicationMode === 'on' ? 'on' : 'shadow',
    };
  }

  private exhausted(budget: Budget, toolCalls: number): 'tool_budget' | 'deadline' | null {
    if (Date.now() >= budget.deadline) return 'deadline';
    if (toolCalls >= budget.maxToolCalls) return 'tool_budget';

    return null;
  }

  /**
   * One tool call, timed, and never able to end the run by throwing.
   *
   * A tool that fails is a fact the agent can work with: it is told what went
   * wrong and can reach for something else. A tool that throws through the
   * loop would lose every fact gathered before it.
   */
  private async runTool(
    tools: AdjudicationTools,
    name: string,
    args: z.infer<typeof TOOL_ARGS_SCHEMA>,
    argsValid: boolean,
  ): Promise<{ result: string; failed: boolean; ms: number }> {
    const startedAt = Date.now();

    if (!argsValid) {
      return {
        result: `Those arguments did not validate. ${name} takes ids and short strings only.`,
        failed: true,
        ms: 0,
      };
    }

    try {
      // Bounded on its own. The run deadline is only tested between turns, so
      // without this one slow read inside a tool runs as long as it likes and
      // the wall-clock bound the design claims is not a bound at all.
      const outcome = await withTimeout(tools.call(name, args), TOOL_TIMEOUT_MS, name);

      return { ...outcome, ms: Date.now() - startedAt };
    } catch (error) {
      log.warn('Adjudication tool threw', { tool: name, error });

      return {
        result: `${name} could not be run. Continue without it.`,
        failed: true,
        ms: Date.now() - startedAt,
      };
    }
  }
}

export const llmAdjudicator = new LlmAdjudicator();
