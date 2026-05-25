# LocalGold

> Local-first insight capture, semantic search, and conversational answers — all on your machine.

LocalGold turns a folder of plain Markdown notes into a personal knowledge tool
with AI you actually own. Capture quick cards from text, images, voice, web links,
or annotated screenshots. Search them with both keyword (FTS5) and semantic
embeddings. Ask questions and get streamed, citation-grounded answers. Nothing
leaves your machine.

---

## Features

- **Capture, fast** — text, comma-separated tags, paste-or-pick images, an
  optional URL, voice notes (recorded → transcribed locally), region
  screenshots with a pen/arrow/rect annotation modal.
- **Hybrid search** — instant client-side keyword filtering layered over
  EmbeddingGemma semantic search, fused with Reciprocal Rank Fusion (RRF).
- **Ask mode** — press **⌘+Enter** in the search box; Gemma 4 streams an
  answer grounded in your top 8 cards, with clickable `[n]` citations that
  scroll back to the source.
- **AI enrichment** — attach an image and Gemma 4 (vision) describes it;
  tick a checkbox to have a URL's page fetched and summarised; a voice note
  is transcribed by Whisper, then tagged by Gemma 4.
- **File-over-app** — every card is a plain Markdown file with YAML
  frontmatter that you can edit, sync, or back up with any tool. The
  SQLite index is rebuildable from disk at any time.
- **Settings → choose your data folder** — store cards wherever you want
  (iCloud, Dropbox, an external drive, a project folder).
- **Minimal dark UI** — Onest + Commit Mono, six-colour role palette
  (rose interactive, purple AI emphasis, blue citation, green ok, orange
  in-progress, red error), Lucide icons.

---

## Quick start

### Requirements

- macOS on **Apple Silicon** (arm64)
- [**Ollama**](https://ollama.com) installed and running locally, with:
  ```bash
  ollama pull embeddinggemma   # ~300 MB — embeddings for semantic search
  ollama pull gemma4:e4b       # ~8 GB   — answers + image/URL enrichment
  ```
- *(Voice notes)* The Whisper-base.en model (~145 MB) downloads on first
  transcription to `~/.cache/huggingface/`. Then offline.

### Run from source

```bash
git clone <repo>
cd LocalGold
npm install
npm run rebuild         # build better-sqlite3 for Electron's Node ABI
npm run dev
```

### Build the installable app

```bash
npm run dist
```

Output in `dist/`:
- `LocalGold-<version>-arm64.dmg` — drag-to-Applications installer
- `mac-arm64/LocalGold.app/` — raw bundle

See [BUILD.md](BUILD.md) for the first-open Gatekeeper note (the app is
unsigned; right-click → Open the first time).

---

## How it works

Electron + TypeScript app, vanilla-TS renderer, no framework.

```
~/Documents/LocalGold/        ← your data (or any folder you pick)
  cards/                      ← one Markdown file per card (source of truth)
    2026-05-21-a3f8c1d2.md
  attachments/                ← pasted/picked images, voice .webm, annotated PNGs
  index.db                    ← rebuildable SQLite cache (FTS5 + embeddings)
  config.json                 ← optional: Ollama URL, model names
```

- **Main process** owns storage (`store.ts`), the rebuildable SQLite index
  (`index-db.ts`), Ollama client (`ollama.ts`), Whisper via
  `@huggingface/transformers` (`transcribe.ts`), and orchestration for
  search, answers, enrichment.
- **Renderer** is plain TS with `innerHTML` templates, talks to main via a
  typed `window.localgold` API exposed by the preload bridge.
- **All AI is local.** Ollama answers on `localhost:11434` for embeddings
  and chat. Whisper runs in the main process via ONNX. The only outbound
  network requests are URL enrichment (opt-in per card) and the Whisper
  model's one-time download.

A card is a Markdown file with YAML frontmatter:

```markdown
---
id: 2026-05-21-a3f8c1d2
created: 2026-05-21T09:30:00Z
tags: [pricing, strategy]
url: https://example.com/article
attachments: [attachments/2026-05-21-a3f8c1d2-1.png]
---

Pricing should reflect value, not cost.

## Image
Whiteboard sketch of a tiered pricing model with three columns labelled
Starter, Team, and Enterprise.
```

---

## Where your data lives

- **Cards:** `~/Documents/LocalGold/` by default; the **Settings** tab lets
  you change it.
- **App preferences** (folder override): `~/Library/Application Support/LocalGold/preferences.json`.
- **Whisper model cache:** `~/.cache/huggingface/`.

---

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development (electron-vite dev) |
| `npm test` | Run the Vitest suite (99 tests, no Ollama needed — uses injected fakes) |
| `npx tsc --noEmit` | Type-check |
| `npm run rebuild` | Rebuild `better-sqlite3` for Electron (run before `dev`) |
| `npm rebuild better-sqlite3` | Rebuild for Node (run before `test`) |
| `npm run dist` | Package as `.app` + `.dmg` |

The `better-sqlite3` ABI quirk: tests run against Node, the app against
Electron. The two rebuild scripts above let you alternate. `npm run dist`
handles its own from-source rebuild.

---

## Design philosophy

- **Local-first.** Your notes never leave your machine. No accounts,
  no cloud, no telemetry, no API keys.
- **File-over-app.** Cards are plain Markdown you own. Open them in
  any editor. Sync with any tool. Delete the app — your notes survive.
- **AI is amplification, not replacement.** Every AI enrichment lands in
  editable fields you can change before saving. The model never auto-commits.
- **Capture is sacred.** Nothing — Ollama down, network out, AI slow —
  blocks saving a card.

---

## Project layout

```
src/
  shared/types.ts           Shared TS types
  main/                     Node/Electron main process
    paths.ts, config.ts, preferences.ts
    store.ts                Card Markdown read/write
    index-db.ts             SQLite + FTS5 + embeddings
    search.ts, rank.ts      Keyword, semantic, hybrid search (RRF)
    ollama.ts               HTTP client: embeddings + streaming chat
    embeddings.ts           Background backfill of stale embeddings
    answer.ts               RAG orchestration for ⌘+Enter
    enrich.ts               Image/URL/text enrichment via Gemma 4
    webpage.ts              HTML → text for URL enrichment
    transcribe.ts           Whisper backend (transformers.js)
    screenshot.ts           macOS screencapture wrapper
    ipc.ts                  All IPC handlers
    index.ts                Electron app entry
  preload/index.ts          Typed contextBridge
  renderer/                 Vanilla-TS UI
    main.ts, index.html, styles.css, env.d.ts
    capture.ts, library.ts, settings.ts, annotate.ts
    audio.ts, shapes.ts, citations.ts, icons.ts
test/                       Vitest suites (99 tests)
docs/superpowers/           Per-phase design specs and implementation plans
build/                      App icon source assets
```

---

## Tech stack

Electron · TypeScript · electron-vite · better-sqlite3 (FTS5) ·
`@huggingface/transformers` (Whisper) · Ollama · Onest + Commit Mono
(Fontsource) · Lucide icons · Vitest · electron-builder

---

## Status

LocalGold is feature-complete for its original scope, built across 12 phases.
Each phase has a design spec and an implementation plan under
[`docs/superpowers/`](docs/superpowers/) — useful if you want to read how a
particular feature was designed and built.

---

## License

MIT — feel free to fork, modify, and run.
