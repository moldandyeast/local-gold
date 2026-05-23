import { describe, it, expect } from 'vitest';
import { enrichImage, enrichUrl } from '../src/main/enrich';

const goodCompleter = {
  complete: async () => ({ description: 'a summary', tags: ['one', 'two'] })
};
const throwingCompleter = {
  complete: async () => {
    throw new Error('ollama down');
  }
};

describe('enrichImage', () => {
  it('returns the parsed description and tags', async () => {
    const result = await enrichImage(goodCompleter, new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ description: 'a summary', tags: ['one', 'two'] });
  });

  it('returns an empty enrichment when the model call throws', async () => {
    const result = await enrichImage(throwingCompleter, new Uint8Array([1]));
    expect(result).toEqual({ description: '', tags: [] });
  });

  it('coerces a malformed model result to an empty enrichment', async () => {
    const result = await enrichImage(
      { complete: async () => 'not an object' },
      new Uint8Array([1])
    );
    expect(result).toEqual({ description: '', tags: [] });
  });
});

describe('enrichUrl', () => {
  it('fetches, extracts and summarises a page', async () => {
    const fetcher = async (): Promise<string> => '<p>Some article body</p>';
    const result = await enrichUrl(goodCompleter, fetcher, 'https://example.com');
    expect(result).toEqual({ description: 'a summary', tags: ['one', 'two'] });
  });

  it('returns an empty enrichment when the fetch throws', async () => {
    const fetcher = async (): Promise<string> => {
      throw new Error('offline');
    };
    const result = await enrichUrl(goodCompleter, fetcher, 'https://example.com');
    expect(result).toEqual({ description: '', tags: [] });
  });

  it('returns an empty enrichment when the page has no text', async () => {
    const result = await enrichUrl(
      goodCompleter,
      async () => '<style>x</style>',
      'https://x.com'
    );
    expect(result).toEqual({ description: '', tags: [] });
  });
});

import { enrichText } from '../src/main/enrich';

describe('enrichText', () => {
  it('returns the parsed tags from a completer', async () => {
    const result = await enrichText(goodCompleter, 'a recorded thought about pricing');
    expect(result.tags).toEqual(['one', 'two']);
  });

  it('returns an empty enrichment for a blank text', async () => {
    expect(await enrichText(goodCompleter, '   ')).toEqual({ description: '', tags: [] });
  });

  it('returns an empty enrichment when the completer throws', async () => {
    expect(await enrichText(throwingCompleter, 'something')).toEqual({
      description: '',
      tags: []
    });
  });
});
