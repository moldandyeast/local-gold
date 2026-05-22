import { describe, it, expect } from 'vitest';
import { parseCitations } from '../src/renderer/citations';

describe('parseCitations', () => {
  it('splits text around [n] markers', () => {
    expect(parseCitations('before [2] after')).toEqual([
      { text: 'before ', citation: null },
      { text: '[2]', citation: 2 },
      { text: ' after', citation: null }
    ]);
  });

  it('returns a single plain segment when there are no markers', () => {
    expect(parseCitations('just text')).toEqual([{ text: 'just text', citation: null }]);
  });

  it('handles consecutive and multi-digit markers', () => {
    expect(parseCitations('[1][12]')).toEqual([
      { text: '[1]', citation: 1 },
      { text: '[12]', citation: 12 }
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCitations('')).toEqual([]);
  });
});
