# LocalGold Phase 2 — Local Semantic Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local semantic search to LocalGold — card bodies are embedded with EmbeddingGemma via Ollama, and every query runs hybrid keyword + semantic search fused into one ranking.

**Architecture:** Three new main-process modules (`config`, `rank`, `ollama`, `embeddings`) plus extensions to `index-db`, `search`, `ipc` and the renderer. Search and the embedding backfill depend on a small `Embedder` interface — the real implementation is `ollama.ts`, and tests inject a fake. Embedding happens in the background; capture and keyword search never block on Ollama.

**Tech Stack:** Electron, TypeScript, better-sqlite3, Ollama HTTP API (`fetch`), EmbeddingGemma, Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: add Embedder, OllamaStatus
  main/
    config.ts            — CREATE: read config.json (ollamaUrl, embedModel)
    rank.ts              — CREATE: cosineSimilarity, reciprocalRankFusion
    ollama.ts            — CREATE: Ollama client (health + embed)
    embeddings.ts        — CREATE: backfill stale card embeddings
    index-db.ts          — MODIFY: embeddings table + accessors
    search.ts            — MODIFY: semanticSearch, hybridSearch
    ipc.ts               — MODIFY: hybrid search, ollama:status, backfill on create
    index.ts             — MODIFY: load config, start backfill, pass deps to ipc
  preload/index.ts       — MODIFY: expose ollamaStatus()
  renderer/library.ts    — MODIFY: semantic-search status line
test/
  index-db.test.ts       — MODIFY: embeddings accessor tests
  config.test.ts         — CREATE
  rank.test.ts           — CREATE
  search.test.ts         — MODIFY: semantic + hybrid tests
  ollama.test.ts         — CREATE
  embeddings.test.ts     — CREATE
```

**Note on `better-sqlite3` ABI:** tests run under Node, the app under Electron.
Run `npm rebuild better-sqlite3` before `npm test`, and `npm run rebuild`
before `npm run dev`. (Same as Phase 1.)

---

## Task 1: index-db — embeddings table and accessors

**Files:**
- Modify: `src/main/index-db.ts`
- Test: `test/index-db.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/index-db.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/index-db.test.ts`
Expected: FAIL — `upsertEmbedding` / `getEmbeddings` / `staleCards` not exported.

- [ ] **Step 3: Add the embeddings table to `initSchema`**

In `src/main/index-db.ts`, inside the `db.exec(` template in `initSchema`, add
the embeddings table just before the closing backtick (after the `meta` table):

```ts
    CREATE TABLE IF NOT EXISTS embeddings (
      card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      model        TEXT NOT NULL,
      dim          INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      vector       BLOB NOT NULL
    );
```

- [ ] **Step 4: Add the embeddings accessors**

Append to `src/main/index-db.ts`:

```ts
/** Encode a Float32 vector as a SQLite BLOB. */
function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Decode a SQLite BLOB back into a Float32 vector (copying, so it is standalone). */
function blobToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Insert or replace a card's embedding. */
export function upsertEmbedding(
  db: DB,
  cardId: string,
  model: string,
  dim: number,
  contentHash: string,
  vector: Float32Array
): void {
  db.prepare(
    `INSERT INTO embeddings (card_id, model, dim, content_hash, vector)
     VALUES (@card_id, @model, @dim, @content_hash, @vector)
     ON CONFLICT(card_id) DO UPDATE SET
       model=@model, dim=@dim, content_hash=@content_hash, vector=@vector`
  ).run({
    card_id: cardId,
    model,
    dim,
    content_hash: contentHash,
    vector: vectorToBlob(vector)
  });
}

/** Every stored embedding, as card id + decoded vector. */
export function getEmbeddings(db: DB): { cardId: string; vector: Float32Array }[] {
  const rows = db.prepare('SELECT card_id, vector FROM embeddings').all() as {
    card_id: string;
    vector: Buffer;
  }[];
  return rows.map((r) => ({ cardId: r.card_id, vector: blobToVector(r.vector) }));
}

/** Cards whose embedding is missing, stale (content changed), or from another model. */
export function staleCards(
  db: DB,
  model: string
): { id: string; body: string; contentHash: string }[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.body AS body, c.content_hash AS contentHash
       FROM cards c LEFT JOIN embeddings e ON e.card_id = c.id
       WHERE e.card_id IS NULL OR e.content_hash != c.content_hash OR e.model != ?`
    )
    .all(model) as { id: string; body: string; contentHash: string }[];
  return rows;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/index-db.test.ts`
Expected: PASS — all `index-db: embeddings` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main/index-db.ts test/index-db.test.ts
git commit -m "feat: add embeddings table and accessors"
```

---

## Task 2: config module

**Files:**
- Create: `src/main/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../src/main/config';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lg-'));
}

describe('config', () => {
  it('returns defaults when config.json is absent', () => {
    const root = tmpRoot();
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://localhost:11434',
      embedModel: 'embeddinggemma'
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('reads values from config.json', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ ollamaUrl: 'http://host:9999', embedModel: 'other' })
    );
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://host:9999',
      embedModel: 'other'
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to defaults for missing or malformed fields', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'config.json'), '{ not valid json');
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://localhost:11434',
      embedModel: 'embeddinggemma'
    });
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot resolve `../src/main/config`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/config.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/** LocalGold runtime configuration. */
export interface Config {
  ollamaUrl: string;
  embedModel: string;
}

const DEFAULTS: Config = {
  ollamaUrl: 'http://localhost:11434',
  embedModel: 'embeddinggemma'
};

/** Read `config.json` from the LocalGold root, falling back to defaults. */
export function loadConfig(root: string): Config {
  let parsed: Partial<Config> = {};
  try {
    parsed = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Partial<Config>;
  } catch {
    parsed = {};
  }
  return {
    ollamaUrl: typeof parsed.ollamaUrl === 'string' ? parsed.ollamaUrl : DEFAULTS.ollamaUrl,
    embedModel: typeof parsed.embedModel === 'string' ? parsed.embedModel : DEFAULTS.embedModel
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts test/config.test.ts
git commit -m "feat: add config module"
```

---

## Task 3: rank — cosine similarity

**Files:**
- Create: `src/main/rank.ts`
- Test: `test/rank.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/rank.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rank.test.ts`
Expected: FAIL — cannot resolve `../src/main/rank`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/rank.ts`:

```ts
/** Cosine similarity of two equal-length vectors. Returns 0 if either is zero. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rank.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/rank.ts test/rank.test.ts
git commit -m "feat: add cosine similarity"
```

---

## Task 4: rank — reciprocal rank fusion

**Files:**
- Modify: `src/main/rank.ts`
- Test: `test/rank.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/rank.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/rank.test.ts`
Expected: FAIL — `reciprocalRankFusion` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/rank.ts`:

```ts
/**
 * Reciprocal Rank Fusion: merge ranked id lists into one ranking. Each id
 * scores Σ 1/(k + rank) over the lists it appears in (rank is 1-based).
 */
export function reciprocalRankFusion(
  lists: string[][],
  k = 60
): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/rank.test.ts`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/rank.ts test/rank.test.ts
git commit -m "feat: add reciprocal rank fusion"
```

---

## Task 5: Embedder interface + semantic search

**Files:**
- Modify: `src/shared/types.ts`, `src/main/search.ts`
- Test: `test/search.test.ts` (append)

- [ ] **Step 1: Add the shared types**

Append to `src/shared/types.ts`:

```ts
/** Embeds text into a vector. `kind` selects EmbeddingGemma's prompt. */
export interface Embedder {
  embed(text: string, kind: 'query' | 'document'): Promise<Float32Array>;
}

/** Reachability of the local Ollama embedding service. */
export interface OllamaStatus {
  /** Ollama answered an HTTP request. */
  reachable: boolean;
  /** The configured embedding model is pulled. */
  hasEmbedModel: boolean;
}
```

- [ ] **Step 2: Write the failing test**

Append to `test/search.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/search.test.ts`
Expected: FAIL — `semanticSearch` not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `src/main/search.ts`:

```ts
import { getEmbeddings } from './index-db';
import { cosineSimilarity } from './rank';
import type { Embedder } from '../shared/types';

/**
 * Semantic search: embed the query and rank cards by cosine similarity to
 * their stored embeddings. Brute-force over all vectors; top 50 returned.
 */
export async function semanticSearch(
  db: DB,
  embedder: Embedder,
  query: string
): Promise<SearchResult[]> {
  const queryVec = await embedder.embed(query, 'query');
  const scored = getEmbeddings(db)
    .map((e) => ({ id: e.cardId, score: cosineSimilarity(queryVec, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  const results: SearchResult[] = [];
  for (const s of scored) {
    const card = getCard(db, s.id);
    if (!card) continue;
    results.push({ card, score: s.score, snippet: card.body.slice(0, 240) });
  }
  return results;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/search.test.ts`
Expected: PASS — `search: keyword` and `search: semantic` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/search.ts test/search.test.ts
git commit -m "feat: add Embedder interface and semantic search"
```

---

## Task 6: hybrid search

**Files:**
- Modify: `src/main/search.ts`
- Test: `test/search.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/search.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search.test.ts`
Expected: FAIL — `hybridSearch` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/search.ts`:

```ts
import { reciprocalRankFusion } from './rank';

/**
 * Hybrid search: run keyword (FTS5) and semantic search, fuse the two
 * rankings with Reciprocal Rank Fusion. If the embedder fails (Ollama
 * unavailable), returns the keyword results alone.
 */
export async function hybridSearch(
  db: DB,
  embedder: Embedder,
  query: string
): Promise<SearchResult[]> {
  const keyword = keywordSearch(db, query);
  let semantic: SearchResult[] = [];
  try {
    semantic = await semanticSearch(db, embedder, query);
  } catch {
    semantic = [];
  }

  // Keyword first, so a card matching both keeps its highlighted snippet.
  const byId = new Map<string, SearchResult>();
  for (const r of [...keyword, ...semantic]) {
    if (!byId.has(r.card.id)) byId.set(r.card.id, r);
  }

  const fused = reciprocalRankFusion([
    keyword.map((r) => r.card.id),
    semantic.map((r) => r.card.id)
  ]);

  return fused.map((f) => {
    const base = byId.get(f.id)!;
    return { card: base.card, score: f.score, snippet: base.snippet };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/search.test.ts`
Expected: PASS — all `search:` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/search.ts test/search.test.ts
git commit -m "feat: add hybrid keyword + semantic search"
```

---

## Task 7: Ollama client

**Files:**
- Create: `src/main/ollama.ts`
- Test: `test/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/ollama.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createOllama } from '../src/main/ollama';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Start a stub Ollama server; returns its base URL. */
function stubOllama(handler: (url: string, res: import('http').ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => handler(req.url ?? '', res));
    server.listen(0, '127.0.0.1', () => {
      const port = (server!.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('ollama: health', () => {
  it('reports reachable and model present', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'embeddinggemma:latest' }] }));
      }
    });
    const ollama = createOllama(url, 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: true, hasEmbedModel: true });
  });

  it('reports reachable but model missing', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'llama3:latest' }] }));
    });
    const ollama = createOllama(url, 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: true, hasEmbedModel: false });
  });

  it('reports unreachable when nothing is listening', async () => {
    const ollama = createOllama('http://127.0.0.1:1', 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: false, hasEmbedModel: false });
  });
});

describe('ollama: embed', () => {
  it('returns a Float32 vector from /api/embed', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/embed') res.end(JSON.stringify({ embeddings: [[0.5, 0.25, 0.125]] }));
    });
    const ollama = createOllama(url, 'embeddinggemma');
    const vec = await ollama.embed('hello', 'query');
    expect(Array.from(vec)).toEqual([0.5, 0.25, 0.125]);
  });

  it('throws when Ollama returns a non-200', async () => {
    const url = await stubOllama((reqUrl, res) => {
      res.statusCode = 500;
      res.end('error');
    });
    const ollama = createOllama(url, 'embeddinggemma');
    await expect(ollama.embed('hello', 'query')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ollama.test.ts`
Expected: FAIL — cannot resolve `../src/main/ollama`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/ollama.ts`:

```ts
import type { Embedder, OllamaStatus } from '../shared/types';

/**
 * EmbeddingGemma prompt prefixes. The model expects a task prefix on every
 * input; query and document use different ones so a query and a card body
 * land in a comparable space.
 */
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

/** A local Ollama client: a health check plus the `Embedder` interface. */
export interface Ollama extends Embedder {
  health(): Promise<OllamaStatus>;
}

/** Build an Ollama client for a base URL and embedding model name. */
export function createOllama(ollamaUrl: string, model: string): Ollama {
  async function health(): Promise<OllamaStatus> {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!res.ok) return { reachable: false, hasEmbedModel: false };
      const data = (await res.json()) as { models?: { name: string }[] };
      const hasEmbedModel = (data.models ?? []).some((m) => m.name.startsWith(model));
      return { reachable: true, hasEmbedModel };
    } catch {
      return { reachable: false, hasEmbedModel: false };
    }
  }

  async function embed(text: string, kind: 'query' | 'document'): Promise<Float32Array> {
    const input = (kind === 'query' ? QUERY_PREFIX : DOCUMENT_PREFIX) + text;
    const res = await fetch(`${ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    if (!vec || vec.length === 0) throw new Error('Ollama embed: empty response');
    return Float32Array.from(vec);
  }

  return { health, embed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ollama.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama.ts test/ollama.test.ts
git commit -m "feat: add Ollama client"
```

---

## Task 8: embedding backfill service

**Files:**
- Create: `src/main/embeddings.ts`
- Test: `test/embeddings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/embeddings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/embeddings.test.ts`
Expected: FAIL — cannot resolve `../src/main/embeddings`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/embeddings.ts`:

```ts
import type { DB } from './index-db';
import { staleCards, upsertEmbedding } from './index-db';
import type { Embedder } from '../shared/types';

/** Outcome of a backfill run. */
export interface BackfillResult {
  /** How many cards were embedded this run. */
  embedded: number;
  /** True if it stopped early because the embedder failed (Ollama down). */
  stopped: boolean;
}

/**
 * Embed every card whose embedding is missing or stale. Idempotent and
 * resumable: stops early (without error) if the embedder throws, leaving
 * the rest stale for a later run.
 */
export async function backfillEmbeddings(
  db: DB,
  embedder: Embedder,
  model: string
): Promise<BackfillResult> {
  const stale = staleCards(db, model);
  let embedded = 0;
  for (const card of stale) {
    let vector: Float32Array;
    try {
      vector = await embedder.embed(card.body, 'document');
    } catch {
      return { embedded, stopped: true };
    }
    if (vector.length === 0) continue;
    upsertEmbedding(db, card.id, model, vector.length, card.contentHash, vector);
    embedded += 1;
  }
  return { embedded, stopped: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/embeddings.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/embeddings.ts test/embeddings.test.ts
git commit -m "feat: add embedding backfill service"
```

---

## Task 9: wire IPC and startup

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`

- [ ] **Step 1: Rewrite `src/main/ipc.ts`**

Replace the contents of `src/main/ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { DB } from './index-db';
import { upsertCard, getCard, listCards, rebuildIndex } from './index-db';
import { writeCard, hashContent } from './store';
import { hybridSearch } from './search';
import { backfillEmbeddings } from './embeddings';
import { cardsDir } from './paths';
import type { Ollama } from './ollama';
import type { NewCard } from '../shared/types';

/** Register every IPC handler the renderer relies on. Call once at startup. */
export function registerIpc(db: DB, root: string, ollama: Ollama, model: string): void {
  ipcMain.handle('card:create', async (_e, input: NewCard) => {
    const card = await writeCard(root, input);
    const filePath = join(cardsDir(root), `${card.id}.md`);
    const raw = await readFile(filePath, 'utf8');
    upsertCard(db, card, filePath, hashContent(raw));
    // Embed the new card in the background; never block the response.
    void backfillEmbeddings(db, ollama, model).catch(() => undefined);
    return card;
  });

  ipcMain.handle('card:list', (_e, limit = 100, offset = 0) => listCards(db, limit, offset));

  ipcMain.handle('card:get', (_e, id: string) => getCard(db, id));

  ipcMain.handle('search:query', (_e, query: string) => hybridSearch(db, ollama, query));

  ipcMain.handle('index:rebuild', () => rebuildIndex(db, root));

  ipcMain.handle('ollama:status', () => ollama.health());
}
```

- [ ] **Step 2: Rewrite `src/main/index.ts`**

Replace the contents of `src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { rootDir, cardsDir, attachmentsDir, dbPath } from './paths';
import { openDb, initSchema, rebuildIndex } from './index-db';
import { registerIpc } from './ipc';
import { loadConfig } from './config';
import { createOllama } from './ollama';
import { backfillEmbeddings } from './embeddings';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const root = rootDir();
  await mkdir(cardsDir(root), { recursive: true });
  await mkdir(attachmentsDir(root), { recursive: true });

  const config = loadConfig(root);
  const ollama = createOllama(config.ollamaUrl, config.embedModel);

  const db = openDb(dbPath(root));
  initSchema(db);
  await rebuildIndex(db, root);
  registerIpc(db, root, ollama, config.embedModel);

  // Backfill embeddings in the background — does not block the window.
  void backfillEmbeddings(db, ollama, config.embedModel).catch(() => undefined);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: wire hybrid search, ollama status and backfill"
```

---

## Task 10: preload + renderer status line

**Files:**
- Modify: `src/preload/index.ts`, `src/renderer/library.ts`

- [ ] **Step 1: Add `ollamaStatus` to the preload bridge**

In `src/preload/index.ts`, update the import, the `LocalGoldApi` interface, and
the `api` object.

Change the import line to:

```ts
import type { Card, NewCard, SearchResult, OllamaStatus } from '../shared/types';
```

Add this method to the `LocalGoldApi` interface (after `rebuild`):

```ts
  ollamaStatus(): Promise<OllamaStatus>;
```

Add this property to the `api` object (after `rebuild`):

```ts
  ollamaStatus: () => ipcRenderer.invoke('ollama:status')
```

- [ ] **Step 2: Show the status line in the library view**

In `src/renderer/library.ts`, replace the `renderLibrary` function with:

```ts
/** Render the library / search view into `host`. */
export function renderLibrary(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Library</h2>
    <div id="ollama-status" class="hint"></div>
    <input id="q" type="text" placeholder="Search cards…" />
    <div id="results"></div>
  `;
  const q = host.querySelector<HTMLInputElement>('#q')!;
  const results = host.querySelector<HTMLDivElement>('#results')!;
  const statusEl = host.querySelector<HTMLDivElement>('#ollama-status')!;

  async function showStatus(): Promise<void> {
    const status = await window.localgold.ollamaStatus();
    if (status.reachable && status.hasEmbedModel) {
      statusEl.textContent = 'Semantic search on';
    } else if (status.reachable) {
      statusEl.textContent = 'Semantic search off — run: ollama pull embeddinggemma';
    } else {
      statusEl.textContent = 'Semantic search offline — start Ollama';
    }
  }

  async function showAll(): Promise<void> {
    const cards = await window.localgold.listCards();
    results.innerHTML = cards.length
      ? cards.map((c) => cardHtml(c)).join('')
      : '<p class="hint">No cards yet.</p>';
  }

  q.addEventListener('input', async () => {
    const term = q.value.trim();
    if (!term) {
      await showAll();
      return;
    }
    const hits = await window.localgold.search(term);
    results.innerHTML = hits.length
      ? hits.map((h) => cardHtml(h.card, h.snippet)).join('')
      : '<p class="hint">No matches.</p>';
  });

  void showStatus();
  void showAll();
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/library.ts
git commit -m "feat: show semantic search status in library view"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test across `store`, `index-db`, `config`, `rank`,
`search`, `ollama`, `embeddings`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify semantic search in the running app**

Run: `npm run rebuild && npm run dev`

With Ollama running and `embeddinggemma` pulled (`ollama pull embeddinggemma`):
- The Library view shows "Semantic search on".
- Capture two cards that share meaning but no words (e.g. "the price is too
  high" and "this costs more than it should"). Search one card's phrasing —
  the other card should also surface in the results.

With Ollama stopped:
- The Library view shows "Semantic search offline — start Ollama".
- Keyword search and capture still work.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 2 complete — local semantic search" --allow-empty
```

---

## Phase 2 Done

Card bodies are embedded locally with EmbeddingGemma via Ollama, and search is
hybrid — keyword and semantic fused with Reciprocal Rank Fusion. Capture and
keyword search never depend on Ollama; embeddings backfill in the background.
Phase 3 (Gemma 4 synthesized answers over retrieved cards) builds on this.
