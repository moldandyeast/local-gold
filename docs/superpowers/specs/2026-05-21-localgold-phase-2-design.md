# LocalGold Phase 2 — Local Semantic Search — Design

**Date:** 2026-05-21
**Status:** Approved for planning
**Builds on:** Phase 1 (capture + keyword search, shipped on `main`)

## Overview

Phase 2 adds local semantic search. Card bodies are embedded with Google's
EmbeddingGemma running in Ollama; queries are embedded the same way and ranked
by cosine similarity. Search becomes hybrid: every query runs both keyword
(FTS5) and semantic search, and the two result lists are fused into one ranking.
Everything stays local — Ollama on `localhost`, no API keys.

## Goals

- **Semantic search** over the card collection, fully local.
- **Hybrid ranking** — semantic catches meaning/paraphrase, keyword catches
  exact terms, names, acronyms, and tags.
- **Capture is never slowed or blocked** — embedding happens in the background.
- **Honest, non-blocking degradation** — when Ollama or the model is
  unavailable, keyword search and capture keep working and the UI says so.

## Non-Goals

- Synthesized answers (Phase 3 — Gemma 4).
- In-app card editing (cards are still edited as Markdown files on disk;
  the existing rebuild detects changed files).
- LM Studio support, vector database extensions, approximate nearest-neighbour
  indexes (brute-force cosine is fast enough at this scale).

## Architecture

Phase 2 adds three modules and extends three. The dependency seam: `search`
and `embeddings` depend on a small `Embedder` interface, not on `ollama`
directly, so they are unit-testable with a fake embedder.

```
ipc ──┬─ search ──────┬─ index-db (cards, FTS, embeddings)
      │               └─ Embedder ◄── ollama
      ├─ embeddings ───┴─ Embedder ◄── ollama
      └─ ollama:status ─ ollama
config ─ (ollama URL + model name)
```

### New modules

- **`src/main/config.ts`** — reads `config.json` from the LocalGold root.
  Returns `{ ollamaUrl, embedModel }` with defaults
  `http://localhost:11434` and `embeddinggemma`. Missing/invalid file →
  defaults.
- **`src/main/ollama.ts`** — HTTP client for Ollama. Implements the `Embedder`
  interface plus a health check. Knows nothing about SQLite.
- **`src/main/embeddings.ts`** — the backfill service: finds stale cards and
  embeds them through an `Embedder`. Knows nothing about HTTP.

### Extended modules

- **`src/main/index-db.ts`** — adds the `embeddings` table to `initSchema` and
  its accessors.
- **`src/main/search.ts`** — adds `semanticSearch` and `hybridSearch`.
- **`src/main/ipc.ts`** — `search:query` now runs `hybridSearch`; new
  `ollama:status` handler.
- **`src/preload/index.ts`** — exposes `ollamaStatus()`.
- **`src/renderer/library.ts`** — shows a semantic-search status line.
- **`src/main/index.ts`** — kicks off background backfill at startup.

### The `Embedder` interface

```ts
/** Embeds text into a vector. `kind` selects EmbeddingGemma's prompt. */
export interface Embedder {
  embed(text: string, kind: 'query' | 'document'): Promise<Float32Array>;
}
```

`ollama.ts` provides the real implementation; tests inject a fake.

## Data Model

A new table in `index.db` (added to `initSchema`):

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  dim          INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  vector       BLOB NOT NULL
);
```

- `vector` — the card body's embedding, a `Float32` array (768 dims for
  EmbeddingGemma), stored as a BLOB.
- `content_hash` — the `cards.content_hash` value at the time the embedding was
  computed. Used to detect staleness.
- `model` — the model name used, so a model change invalidates old vectors.

`ON DELETE CASCADE` plus the existing rebuild keeps embeddings consistent with
cards. (Rebuild does an explicit `deleteCard`, which cascades.)

### Staleness rule

A card needs (re)embedding when **any** of the following holds:

1. it has no `embeddings` row, **or**
2. `embeddings.content_hash` ≠ the card's current `cards.content_hash`
   (the card was edited on disk), **or**
3. `embeddings.model` ≠ the configured `embedModel`.

`staleEmbeddingIds(db, model)` returns these card ids with a single SQL query.

## Ollama Integration

- **Endpoint:** `POST {ollamaUrl}/api/embed` with `{ model, input }`, response
  `{ embeddings: [[...]] }`.
- **Prompt convention:** EmbeddingGemma expects task prefixes. `ollama.ts`
  prepends the documented *query* prefix when `kind === 'query'` and the
  *document* prefix when `kind === 'document'`, so a query and a card body land
  in the same space. (The exact prefix strings are pinned in the implementation
  plan against EmbeddingGemma's current documentation.)
- **Health:** `health()` does `GET {ollamaUrl}/api/tags` and returns
  `{ reachable: boolean, hasEmbedModel: boolean }` — reachable means Ollama
  answered; `hasEmbedModel` means `embeddinggemma` is in the tag list.
- **Failures:** connection refused, timeout (short, e.g. 2s for health), and
  non-200 responses all resolve to a defined result — never an unhandled
  rejection. `embed` throws a typed error that callers treat as "unavailable".

## Backfill Service

`backfillEmbeddings(db, embedder, model)`:

1. Get `staleEmbeddingIds(db, model)`.
2. For each, read the card, `embedder.embed(body, 'document')`, and
   `upsertEmbedding(db, cardId, model, dim, contentHash, vector)`.
3. If `embed` throws (Ollama unavailable), stop early and return how many were
   done — remaining cards stay stale and are retried later.

It is idempotent and resumable: re-running embeds only what is still stale.

### When it runs

- **Startup:** `index.ts` runs `backfillEmbeddings` *after* `rebuildIndex`, not
  awaited before the window opens — the app is usable immediately.
- **On capture:** after `card:create` writes and indexes the card, a
  fire-and-forget `backfillEmbeddings` embeds it (and any other stragglers).
- Both paths are no-ops when Ollama is down; the next run picks up the slack.

## Search

### `semanticSearch(db, embedder, query)`

Embed the query (`kind: 'query'`), compute cosine similarity against every
stored vector, return cards ranked by similarity (top 50). Vectors are read
from `embeddings` and compared in JavaScript — brute-force, which is
sub-millisecond for thousands of cards.

### `hybridSearch(db, embedder, query)`

1. Run `keywordSearch` (Phase 1, FTS5) and `semanticSearch` in parallel.
2. Fuse with **Reciprocal Rank Fusion**: a card's fused score is
   `Σ 1 / (k + rank)` over each list it appears in, `k = 60`, `rank` 1-based.
   Rank-based fusion needs no normalization between FTS rank and cosine score.
3. Deduplicate by card id, sort by fused score, return `SearchResult[]`. The
   `snippet` is taken from the keyword hit when present, otherwise a body
   prefix.
4. If `semanticSearch` fails (Ollama unavailable), `hybridSearch` returns the
   keyword results alone.

`SearchResult.score` becomes the fused RRF score (Phase 1 used a placeholder).

## Error Handling

- **Ollama unreachable / model missing:** capture and keyword search are
  unaffected; semantic search silently falls back to keyword; backfill is a
  no-op. The UI status line states what is wrong and how to fix it.
- **Embed returns wrong-sized vector:** treated as an embed failure for that
  card; logged, card stays stale, not stored.
- **Corrupt `embeddings` row:** `index.db` remains disposable — deleting it and
  restarting rebuilds cards and re-embeds from scratch.

## UI

The Library view gains one status line above the results, fed by an
`ollama:status` IPC call on view load:

- reachable + model pulled → "Semantic search on"
- reachable, model missing → "Semantic search off — run: `ollama pull embeddinggemma`"
- unreachable → "Semantic search offline — start Ollama"

Results render exactly as in Phase 1; only the ranking improves.

## Testing

- **`config.ts`** — defaults when file absent; parse of a valid file;
  fallback to defaults on malformed JSON.
- **`ollama.ts`** — against a mock HTTP server: reachable vs refused, model
  present vs absent, a valid `/api/embed` response, a non-200 response.
- **`cosineSimilarity`** and the **RRF merge** — pure unit tests with hand-built
  vectors and rankings.
- **`semanticSearch` / `hybridSearch`** — with an injected fake `Embedder`
  returning deterministic vectors; verify ranking and keyword-only fallback.
- **`backfillEmbeddings`** — fake `Embedder` + temp `index.db`: embeds only
  stale cards, is idempotent, stops cleanly when the embedder throws.
- **`index-db`** embeddings accessors — upsert, read, staleness query.

All Phase 2 logic is testable with no running Ollama.
