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

import { reciprocalRankFusion } from '../src/main/rank';

describe('reciprocalRankFusion', () => {
  it('ranks an id appearing high in both lists first', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'a', 'd']
    ]);
    expect(fused[0].id).toBe('a');
    expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sums contributions across lists with k=60', () => {
    const fused = reciprocalRankFusion([['x'], ['x']]);
    expect(fused[0].id).toBe('x');
    expect(fused[0].score).toBeCloseTo(2 / 61);
  });

  it('ranks an id in both lists above an id in only one', () => {
    const fused = reciprocalRankFusion([
      ['shared', 'lonely'],
      ['shared']
    ]);
    expect(fused[0].id).toBe('shared');
    expect(fused[1].id).toBe('lonely');
  });

  it('returns an empty array for no lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
