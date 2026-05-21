# LocalGold — Design

**Date:** 2026-05-21
**Status:** Approved for planning

## Overview

LocalGold is a local-first desktop app for capturing insights as cards and,
later, searching them semantically. You capture freeform text (with optional
tags and pasted images) the moment a thought lands. Over time the collection
becomes a personal search engine: you ask a question, the app retrieves the
most relevant cards, and synthesizes an answer grounded in them — all running
entirely on your machine.

## Goals

- **Frictionless capture.** Write text, optionally tag it, optionally paste an
  image, save. No required fields beyond the text.
- **Local-first and durable.** Cards live as plain Markdown files on disk. The
  app never depends on a network service to read or write them.
- **Semantic search, fully local.** Embeddings and answer synthesis run through
  Ollama on `localhost` — no API keys, no cloud.
- **Wrappable / portable core.** Storage and search logic stay independent of
  Electron specifics so the engine could be reused in another shell later.

## Non-Goals

- Global capture shortcut (deferred to a later phase — Phase 1 capture is a
  normal app window).
- Link unfurling / preview fetching (links are plain URLs in the text).
- Arbitrary file attachments (images only for now).
- Multi-device sync (the `cards/` folder can be synced by external tools like
  iCloud/Dropbox, but the app does not manage sync).
- LM Studio support (Ollama only for now; LM Studio is an easy later add).

## Architecture

Electron app, TypeScript throughout, built with electron-vite.

```
┌─────────────────────────────────────────────┐
│ Renderer (vanilla TS, single-page UI)        │
│  - Capture view                              │
│  - Library / search view                     │
└───────────────┬─────────────────────────────┘
                │ IPC (typed, contextBridge)
┌───────────────┴─────────────────────────────┐
│ Main process                                 │
│  store    — read/write card files + images   │
│  index    — SQLite (FTS5 + embeddings)        │
│  ollama   — embeddings + chat client          │
│  search   — keyword + semantic + synthesis    │
│  ipc      — handlers bridging renderer ↔ main │
└───────────────────────────────────────────────┘
        │                          │
   ~/Documents/LocalGold/      localhost:11434
   (files = source of truth)   (Ollama)
```

**Source of truth = the `cards/` folder.** `index.db` is a derived cache that
can be deleted and rebuilt from the Markdown files at any time.

## Storage Layout

```
~/Documents/LocalGold/
  cards/         <stem>.md          one Markdown file per card
  attachments/   <stem>-<n>.<ext>   pasted images
  index.db       SQLite — rebuildable cache (gitignored)
  config.json    user settings (Ollama URL, model names)
```

### Card file format

Filename stem: `YYYYMMDD-HHMMSS-<slug>` where `<slug>` is derived from the first
few words of the body. The stem is also the card's `id`.

```markdown
---
id: 20260521-093000-first-thoughts-on-x
created: 2026-05-21T09:30:00Z
tags: [idea, research]
attachments: [attachments/20260521-093000-first-thoughts-on-x-1.png]
---

Freeform Markdown body text. Links are plain URLs left inline.
```

`tags` and `attachments` are optional and default to empty.

### SQLite schema (`index.db`)

```sql
CREATE TABLE cards (
  id           TEXT PRIMARY KEY,
  created      TEXT NOT NULL,
  body         TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array
  file_path    TEXT NOT NULL,
  content_hash TEXT NOT NULL                -- sha256 of file contents
);

CREATE VIRTUAL TABLE cards_fts USING fts5(
  body, tags, content='cards', content_rowid='rowid'
);

CREATE TABLE embeddings (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  model   TEXT NOT NULL,
  dim     INTEGER NOT NULL,
  vector  BLOB NOT NULL                     -- Float32 array
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

### Index rebuild

A `rebuild` operation scans `cards/`, and for each file: if its `content_hash`
is unknown or changed, it re-parses the card, upserts `cards`/`cards_fts`, and
marks the embedding stale. Files absent from `cards/` are deleted from the
index. Rebuild runs on startup (fast — only changed files do work) and can be
triggered manually.

## Modules

**Main process**

- `store` — parse/serialize card Markdown, write attachment files, list/read
  cards. Knows the on-disk format; knows nothing about SQLite or Ollama.
- `index` — owns `index.db`: schema, upserts, FTS queries, embedding
  read/write, rebuild logic.
- `ollama` — HTTP client for `localhost:11434`. Methods: `health()`,
  `embed(texts, kind)`, `chat(messages)`. Surfaces a clear "unavailable" state.
- `search` — orchestration: keyword search (Phase 1), semantic search
  (Phase 2), synthesized answer (Phase 3).
- `ipc` — registers typed IPC handlers; the only main-side module the renderer
  talks to.

**Renderer** (vanilla TS, no framework)

- Capture view — textarea, tag input, image paste/drop, save.
- Library/search view — query box, results list, card detail.

### IPC surface

| Channel          | Direction | Purpose                                  |
|------------------|-----------|------------------------------------------|
| `card:create`    | R → M     | Save a new card (body, tags, images)     |
| `card:list`      | R → M     | List cards, newest first, paginated      |
| `card:get`       | R → M     | Fetch one card by id                     |
| `search:query`   | R → M     | Run a search, return ranked results      |
| `index:rebuild`  | R → M     | Force a full index rebuild               |
| `ollama:status`  | R → M     | Report Ollama reachability + models      |

## Local AI (Ollama)

All AI runs through Ollama on `localhost:11434`, configurable in `config.json`.

- **Embeddings: EmbeddingGemma** (`embeddinggemma`). 308M params, on-device,
  768-dim output. EmbeddingGemma expects task-specific prompt prefixes — the
  `ollama` module applies the documented *query* prefix when embedding a search
  query and the *document* prefix when embedding a card body, so the two are
  comparable.
- **Synthesis: Gemma 4 E4B** (`gemma4`, the default tag). Model name is
  configurable so it can be pointed at `gemma4:31b` or another pulled model.

Vectors are stored as `Float32` BLOBs. Search embeds the query and computes
cosine similarity against every stored vector in JavaScript — a brute-force
scan, which is instant for the thousands-of-cards scale this app targets. No
vector extension or native dependency beyond `better-sqlite3`.

### Graceful degradation

Capture never depends on Ollama. If Ollama is unreachable:

- New cards are saved and indexed for keyword search immediately; their
  embeddings are marked stale.
- When Ollama becomes reachable again, stale cards are embedded (on next
  rebuild/startup, or on the next search).
- Semantic search and synthesized answers report "Ollama unavailable" and the
  UI falls back to keyword search.

## Search Behavior

- **Phase 1 — keyword.** `search:query` runs an FTS5 match over body + tags,
  returns ranked cards.
- **Phase 2 — semantic.** The query is embedded; results are ranked by cosine
  similarity. Keyword and semantic results are merged (semantic primary,
  keyword as fallback/boost).
- **Phase 3 — synthesized answer.** The top-K cards become context for a Gemma
  chat prompt. The response is an answer plus citations referencing the source
  cards by id, shown above the ranked card list.

## Phasing

- **Phase 1 — Capture + keyword search.** Electron shell, capture view, cards
  on disk + SQLite index, library view, FTS5 keyword search, index rebuild.
  A complete, usable capture tool with no AI dependency.
- **Phase 2 — Semantic search.** Ollama client, EmbeddingGemma embeddings,
  cosine ranking, stale-embedding handling.
- **Phase 3 — Synthesized answers.** Gemma 4 chat over top-K retrieved cards,
  answer with citations.

## Error Handling

- **Card parse failure.** A malformed card file is skipped during rebuild and
  surfaced as a warning; it never aborts the rebuild or crashes the app.
- **Index corruption.** `index.db` is disposable — on an unrecoverable error it
  is deleted and rebuilt from `cards/`.
- **Ollama errors.** Timeouts and connection failures resolve to a clear
  "unavailable" state, never an unhandled rejection. See graceful degradation.
- **Attachment write failure.** The card is still saved; the failed image is
  reported to the user rather than lost silently.

## Testing

- **Unit tests (Vitest)** for `store`, `index`, and `search` against a
  temporary `LocalGold/` directory: round-trip card serialization, rebuild
  correctness (added/changed/deleted files), FTS queries, cosine ranking.
- **`ollama` module** tested against a mock local HTTP server covering the
  healthy, unreachable, and error responses.
- **Renderer** kept thin; logic lives in tested main-process modules.
- Each phase ships with its own tests; Phase 1 is fully testable with no Ollama
  dependency.
```
