import { describe, it, expect } from 'vitest';
import { openDb, initSchema, upsertCard, getEmbeddings, staleCards } from '../src/main/index-db';
import { backfillEmbeddings } from '../src/main/embeddings';
import type { Card, Embedder } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-22T09:00:00.000Z', body, tags: [], attachments: [] };
}

/** Embedder that records calls and returns a fixed vector. */
function countingEmbedder(): Embedder & { calls: number } {
  const e = {
    calls: 0,
    embed: async () => {
      e.calls += 1;
      return Float32Array.from([1, 0, 0]);
    }
  };
  return e;
}

describe('backfillEmbeddings', () => {
  it('embeds every stale card', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'one'), '/p/a.md', 'ha');
    upsertCard(db, card('b', 'two'), '/p/b.md', 'hb');
    const embedder = countingEmbedder();
    const result = await backfillEmbeddings(db, embedder, 'embeddinggemma');
    expect(result).toEqual({ embedded: 2, stopped: false });
    expect(getEmbeddings(db)).toHaveLength(2);
    db.close();
  });

  it('is idempotent — a second run embeds nothing', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'one'), '/p/a.md', 'ha');
    const embedder = countingEmbedder();
    await backfillEmbeddings(db, embedder, 'embeddinggemma');
    const second = await backfillEmbeddings(db, embedder, 'embeddinggemma');
    expect(second).toEqual({ embedded: 0, stopped: false });
    expect(embedder.calls).toBe(1);
    db.close();
  });

  it('stops cleanly when the embedder throws', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'one'), '/p/a.md', 'ha');
    upsertCard(db, card('b', 'two'), '/p/b.md', 'hb');
    const broken: Embedder = {
      embed: async () => {
        throw new Error('Ollama down');
      }
    };
    const result = await backfillEmbeddings(db, broken, 'embeddinggemma');
    expect(result).toEqual({ embedded: 0, stopped: true });
    expect(staleCards(db, 'embeddinggemma')).toHaveLength(2);
    db.close();
  });
});
