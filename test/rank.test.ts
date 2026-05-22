import { describe, it, expect } from 'vitest';
import { cosineSimilarity } from '../src/main/rank';

describe('cosineSimilarity', () => {
  it('is 1 for identical direction vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 2, 3]), Float32Array.from([2, 4, 6]))).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 1]), Float32Array.from([-1, -1]))).toBeCloseTo(-1);
  });

  it('returns 0 when either vector is all zeros', () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });
});
