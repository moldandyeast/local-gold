import { describe, it, expect } from 'vitest';
import { openDb, initSchema } from '../src/main/index-db';

describe('index-db: schema', () => {
  it('creates the cards, cards_fts and meta tables', () => {
    const db = openDb(':memory:');
    initSchema(db);
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).toContain('cards');
    expect(names).toContain('cards_fts');
    expect(names).toContain('meta');
    db.close();
  });

  it('is idempotent — initSchema can run twice', () => {
    const db = openDb(':memory:');
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });
});

import { upsertCard, deleteCard, getCard, listCards, allHashes, searchFts } from '../src/main/index-db';
import type { Card } from '../src/shared/types';

function sampleCard(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    created: '2026-05-21T09:00:00.000Z',
    body: 'the quick brown fox',
    tags: ['animal'],
    attachments: [],
    ...over
  };
}

describe('index-db: upsert/query', () => {
  it('upserts and reads a card back', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    const got = getCard(db, 'c1');
    expect(got?.body).toBe('the quick brown fox');
    expect(got?.tags).toEqual(['animal']);
    db.close();
  });

  it('upsert on the same id updates in place', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertCard(db, sampleCard({ body: 'updated body' }), '/p/c1.md', 'hash2');
    expect(getCard(db, 'c1')?.body).toBe('updated body');
    expect(listCards(db, 100, 0)).toHaveLength(1);
    db.close();
  });

  it('deleteCard removes the row', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    deleteCard(db, 'c1');
    expect(getCard(db, 'c1')).toBeNull();
    db.close();
  });

  it('allHashes maps id to content hash', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    expect(allHashes(db).get('c1')).toBe('hash1');
    db.close();
  });

  it('listCards returns newest first', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard({ id: 'old', created: '2026-01-01T00:00:00.000Z' }), '/p/old.md', 'h');
    upsertCard(db, sampleCard({ id: 'new', created: '2026-09-01T00:00:00.000Z' }), '/p/new.md', 'h');
    expect(listCards(db, 100, 0).map((c) => c.id)).toEqual(['new', 'old']);
    db.close();
  });

  it('searchFts matches body terms and ignores punctuation in the query', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'h');
    expect(searchFts(db, 'brown').map((h) => h.id)).toEqual(['c1']);
    expect(searchFts(db, 'quick!! fox?').map((h) => h.id)).toEqual(['c1']);
    expect(searchFts(db, 'elephant')).toEqual([]);
    expect(searchFts(db, '   ')).toEqual([]);
    db.close();
  });
});

import { rebuildIndex } from '../src/main/index-db';
import { writeCard } from '../src/main/store';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pjoin } from 'path';

describe('index-db: rebuild', () => {
  it('indexes cards found on disk', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    await writeCard(root, { body: 'disk card one', tags: [], images: [] });
    const db = openDb(':memory:');
    initSchema(db);
    await rebuildIndex(db, root);
    expect(listCards(db, 100, 0)).toHaveLength(1);
    expect(searchFts(db, 'disk').length).toBe(1);
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('drops index rows whose card file no longer exists', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(
      db,
      { id: 'ghost', created: '2026-01-01T00:00:00.000Z', body: 'x', tags: [], attachments: [] },
      '/p/ghost.md',
      'h'
    );
    await rebuildIndex(db, root);
    expect(getCard(db, 'ghost')).toBeNull();
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('skips files whose hash is unchanged on a second rebuild', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    await writeCard(root, { body: 'stable card', tags: [], images: [] });
    const db = openDb(':memory:');
    initSchema(db);
    await rebuildIndex(db, root);
    const firstHash = [...allHashes(db).values()][0];
    await rebuildIndex(db, root);
    expect([...allHashes(db).values()][0]).toBe(firstHash);
    rmSync(root, { recursive: true, force: true });
    db.close();
  });
});

import { upsertEmbedding, getEmbeddings, staleCards } from '../src/main/index-db';

describe('index-db: embeddings', () => {
  it('stores and reads back an embedding vector', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertEmbedding(db, 'c1', 'embeddinggemma', 3, 'hash1', Float32Array.from([0.1, 0.2, 0.3]));
    const rows = getEmbeddings(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].cardId).toBe('c1');
    expect(Array.from(rows[0].vector)).toEqual([
      Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)
    ]);
    db.close();
  });

  it('upsertEmbedding replaces an existing vector', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertEmbedding(db, 'c1', 'embeddinggemma', 2, 'hash1', Float32Array.from([1, 0]));
    upsertEmbedding(db, 'c1', 'embeddinggemma', 2, 'hash2', Float32Array.from([0, 1]));
    const rows = getEmbeddings(db);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0].vector)).toEqual([0, 1]);
    db.close();
  });

  it('staleCards lists cards with no embedding', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    expect(staleCards(db, 'embeddinggemma').map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  it('staleCards lists cards whose content changed since embedding', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertEmbedding(db, 'c1', 'embeddinggemma', 1, 'hash1', Float32Array.from([1]));
    expect(staleCards(db, 'embeddinggemma')).toEqual([]);
    upsertCard(db, sampleCard({ body: 'edited' }), '/p/c1.md', 'hash2');
    expect(staleCards(db, 'embeddinggemma').map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  it('staleCards lists cards embedded with a different model', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertEmbedding(db, 'c1', 'old-model', 1, 'hash1', Float32Array.from([1]));
    expect(staleCards(db, 'embeddinggemma').map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  it('staleCards returns id, body and contentHash for backfill', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard({ body: 'fox body' }), '/p/c1.md', 'hash1');
    expect(staleCards(db, 'embeddinggemma')[0]).toEqual({
      id: 'c1', body: 'fox body', contentHash: 'hash1'
    });
    db.close();
  });
});

describe('index-db: url', () => {
  it('upsert then getCard preserves a url', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard({ url: 'https://example.com' }), '/p/c1.md', 'h');
    expect(getCard(db, 'c1')?.url).toBe('https://example.com');
    db.close();
  });

  it('a card with no url reads back without one', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'h');
    expect(getCard(db, 'c1')?.url).toBeUndefined();
    db.close();
  });
});
