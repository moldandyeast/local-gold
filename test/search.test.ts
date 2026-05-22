import { describe, it, expect } from 'vitest';
import { openDb, initSchema, upsertCard } from '../src/main/index-db';
import { keywordSearch } from '../src/main/search';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-21T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('search: keyword', () => {
  it('returns matching cards with a snippet', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'meeting notes about pricing'), '/p/a.md', 'h');
    upsertCard(db, card('b', 'unrelated grocery list'), '/p/b.md', 'h');
    const results = keywordSearch(db, 'pricing');
    expect(results).toHaveLength(1);
    expect(results[0].card.id).toBe('a');
    expect(results[0].snippet).toContain('«pricing»');
    db.close();
  });

  it('returns an empty array when nothing matches', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'hello'), '/p/a.md', 'h');
    expect(keywordSearch(db, 'absent')).toEqual([]);
    db.close();
  });
});

import { semanticSearch } from '../src/main/search';
import { upsertEmbedding } from '../src/main/index-db';
import type { Embedder } from '../src/shared/types';

/** Fake embedder: returns a fixed vector per text, no network. */
function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return {
    embed: async (text) => Float32Array.from(map[text] ?? [0, 0, 0])
  };
}

describe('search: semantic', () => {
  it('ranks cards by cosine similarity to the query', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('near', 'near card'), '/p/near.md', 'h');
    upsertCard(db, card('far', 'far card'), '/p/far.md', 'h');
    upsertEmbedding(db, 'near', 'm', 3, 'h', Float32Array.from([1, 0, 0]));
    upsertEmbedding(db, 'far', 'm', 3, 'h', Float32Array.from([0, 1, 0]));
    const embedder = fakeEmbedder({ 'find this': [1, 0, 0] });
    const results = await semanticSearch(db, embedder, 'find this');
    expect(results[0].card.id).toBe('near');
    expect(results[1].card.id).toBe('far');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    db.close();
  });

  it('returns an empty array when there are no embeddings', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    const embedder = fakeEmbedder({ q: [1, 0, 0] });
    expect(await semanticSearch(db, embedder, 'q')).toEqual([]);
    db.close();
  });
});

import { hybridSearch } from '../src/main/search';

describe('search: hybrid', () => {
  it('fuses keyword and semantic results into one ranking', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('kw', 'pricing strategy notes'), '/p/kw.md', 'h');
    upsertCard(db, card('sem', 'how much should it cost'), '/p/sem.md', 'h');
    upsertEmbedding(db, 'kw', 'm', 3, 'h', Float32Array.from([0, 1, 0]));
    upsertEmbedding(db, 'sem', 'm', 3, 'h', Float32Array.from([1, 0, 0]));
    const embedder = fakeEmbedder({ pricing: [1, 0, 0] });
    const results = await hybridSearch(db, embedder, 'pricing');
    const ids = results.map((r) => r.card.id);
    expect(ids).toContain('kw');
    expect(ids).toContain('sem');
    db.close();
  });

  it('keeps the highlighted keyword snippet when a card matches both', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('c', 'pricing notes'), '/p/c.md', 'h');
    upsertEmbedding(db, 'c', 'm', 3, 'h', Float32Array.from([1, 0, 0]));
    const embedder = fakeEmbedder({ pricing: [1, 0, 0] });
    const results = await hybridSearch(db, embedder, 'pricing');
    expect(results[0].snippet).toContain('«pricing»');
    db.close();
  });

  it('falls back to keyword results when the embedder throws', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('c', 'pricing notes'), '/p/c.md', 'h');
    const broken: Embedder = {
      embed: async () => {
        throw new Error('Ollama unavailable');
      }
    };
    const results = await hybridSearch(db, broken, 'pricing');
    expect(results.map((r) => r.card.id)).toEqual(['c']);
    db.close();
  });
});
