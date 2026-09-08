/**
 * Trace context.
 *
 * The correlation id is the only thing tying an API request to the job a
 * worker ran for it minutes later, in another process. These pin the two
 * properties that makes possible: an inbound trace is joined rather than
 * replaced, and the context survives every await in between.
 */

import { describe, expect, it } from 'vitest';
import {
  continueTrace,
  createTraceContext,
  currentTraceparent,
  formatTraceparent,
  getTraceContext,
  parseTraceparent,
  runWithTraceContext,
} from './context.js';

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('parseTraceparent', () => {
  it('reads a valid header', () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
  });

  it('accepts an upper-case header, because the spec allows one', () => {
    expect(parseTraceparent(VALID.toUpperCase())?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it.each([
    ['nothing', undefined],
    ['an empty string', ''],
    ['a future version', '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['a short trace id', '00-4bf92f35-00f067aa0ba902b7-01'],
    ['a non-hex trace id', '00-zzf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['an all-zero trace id', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
    ['an all-zero span id', '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'],
  ])('refuses %s', (_label, header) => {
    expect(parseTraceparent(header)).toBeNull();
  });
});

describe('continueTrace', () => {
  it('keeps the caller trace id and takes a new span id', () => {
    const context = continueTrace(VALID);

    expect(context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(context.spanId).not.toBe('00f067aa0ba902b7');
  });

  it('starts a trace when the header is missing or unusable', () => {
    expect(continueTrace(undefined).traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(continueTrace('garbage').traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('round-trips through the wire format', () => {
    const context = createTraceContext();

    expect(parseTraceparent(formatTraceparent(context))).toEqual(context);
  });
});

describe('ambient context', () => {
  it('survives awaits, which is the whole point of it', async () => {
    const context = createTraceContext();

    const seen = await runWithTraceContext(context, async () => {
      await Promise.resolve();
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });

      return getTraceContext()?.traceId;
    });

    expect(seen).toBe(context.traceId);
  });

  it('does not leak out of the run', async () => {
    await runWithTraceContext(createTraceContext(), async () => undefined);

    expect(getTraceContext()).toBeUndefined();
  });

  it('keeps concurrent runs apart', async () => {
    const first = createTraceContext();
    const second = createTraceContext();

    const read = async (context: ReturnType<typeof createTraceContext>, delay: number) =>
      runWithTraceContext(context, async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });

        return getTraceContext()?.traceId;
      });

    const [a, b] = await Promise.all([read(first, 5), read(second, 1)]);

    expect(a).toBe(first.traceId);
    expect(b).toBe(second.traceId);
  });

  it('hands out a fresh traceparent when there is no ambient context', () => {
    expect(currentTraceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});
