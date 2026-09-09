/**
 * Schema-constrained replies.
 *
 * A spec carries both shapes on purpose: the JSON Schema is what an OpenAI or
 * Gemini request needs on the wire, the zod schema is what validates whatever
 * came back. Providers that cannot constrain output are still held to the same
 * bar, because validation happens here rather than in the adapter.
 */

import type { z } from 'zod';

export interface StructuredSpec<T> {
  /** Names the schema for providers that require one. */
  name: string;
  jsonSchema: Record<string, unknown>;
  schema: z.ZodType<T>;
}

export function defineStructured<T>(spec: StructuredSpec<T>): StructuredSpec<T> {
  return spec;
}

/**
 * Pull the JSON out of a reply that may be wrapped in prose or a code fence.
 *
 * Needed for providers with no schema mode, and as a second chance for the
 * ones that have it: a model asked for JSON sometimes still says "Sure!".
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // A reply with prose around the object: take the outermost braces.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start === -1 || end <= start) return null;

    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * The instruction added for providers that cannot constrain the reply.
 *
 * Asking is weaker than constraining, which is exactly why the capability is
 * declared per provider and the validation is not optional.
 */
export function schemaInstruction(spec: StructuredSpec<unknown>): string {
  return [
    `Respond with a single JSON object and nothing else. No prose, no code fence.`,
    `It must satisfy this JSON Schema:`,
    JSON.stringify(spec.jsonSchema),
  ].join('\n');
}
