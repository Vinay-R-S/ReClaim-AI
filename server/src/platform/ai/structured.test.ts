/**
 * Reading JSON out of a model's reply.
 *
 * Every provider except two answers a schema request with a best effort, and
 * "best effort" in practice means a code fence, a sentence of preamble, or
 * both. Each of these is a shape a real reply has arrived in.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineStructured, extractJson, schemaInstruction } from './structured.js';

describe('extractJson', () => {
  it('reads a bare object', () => {
    expect(extractJson('{"score": 80}')).toEqual({ score: 80 });
  });

  it('reads an object inside a fenced block', () => {
    expect(extractJson('```json\n{"score": 80}\n```')).toEqual({ score: 80 });
  });

  it('reads an object inside an unlabelled fence', () => {
    expect(extractJson('```\n{"score": 80}\n```')).toEqual({ score: 80 });
  });

  it('reads an object wrapped in prose', () => {
    expect(extractJson('Sure! Here it is: {"score": 80} Hope that helps.')).toEqual({ score: 80 });
  });

  it('handles surrounding whitespace', () => {
    expect(extractJson('\n\n  {"score": 80}  \n')).toEqual({ score: 80 });
  });

  it('returns null for a reply with no object in it', () => {
    expect(extractJson('I could not tell.')).toBeNull();
  });

  it('returns null for something that only looks like JSON', () => {
    expect(extractJson('{score: 80,}')).toBeNull();
  });
});

describe('schemaInstruction', () => {
  it('names the schema and forbids anything around it', () => {
    const spec = defineStructured({
      name: 'verdict',
      schema: z.object({ score: z.number() }),
      jsonSchema: { type: 'object', properties: { score: { type: 'number' } } },
    });

    const instruction = schemaInstruction(spec);

    expect(instruction).toContain('JSON object and nothing else');
    expect(instruction).toContain('"score"');
  });
});
