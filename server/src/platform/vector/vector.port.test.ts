/**
 * The two conversions every caller of the vector port reasons in.
 *
 * Both exist because an earlier version got the arithmetic wrong in a way that
 * still produced a plausible-looking number, which is the failure mode worth
 * testing: a similarity that is on the wrong scale is not caught by anything
 * downstream, it just quietly moves every threshold reasoned about in it.
 */

import { describe, expect, it } from 'vitest';
import { cosineSimilarity, similarityFromDistance } from './vector.port.js';

describe('similarityFromDistance', () => {
  it('subtracts rather than rescales', () => {
    // The distance is `1 - cosine`, so 0.135 is a cosine of 0.865. An earlier
    // version divided the [0,2] range by two and read 0.6 for a pair whose
    // actual cosine was 0.2.
    expect(similarityFromDistance(0.135)).toBeCloseTo(0.865, 5);
    expect(similarityFromDistance(0)).toBe(1);
  });

  it('clamps an opposed pair at zero rather than reporting a negative', () => {
    expect(similarityFromDistance(1.5)).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  it('normalises, so a vector that is not unit length still reads as a cosine', () => {
    // The whole reason the function divides. Both of these are the same
    // direction at four times the magnitude: a bare dot product answers 16.
    const a = Float32Array.from([4, 0]);
    const b = Float32Array.from([4, 0]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('gives the same answer whatever the magnitudes are', () => {
    const unit = cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0.6, 0.8]));
    const scaled = cosineSimilarity(Float32Array.from([7, 0]), Float32Array.from([3, 4]));

    expect(unit).toBeCloseTo(0.6, 5);
    expect(scaled).toBeCloseTo(0.6, 5);
  });

  it('reports an orthogonal pair as zero', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 5);
  });

  it('refuses two vectors of different lengths, which are two different models', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0]))).toBeNull();
  });

  it('refuses an empty vector and a zero vector rather than dividing by zero', () => {
    expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBeNull();
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 0]))).toBeNull();
  });
});
