# LocalGold Phase 7 — AI Enrichment — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Builds on:** Phases 1–6 (capture, hybrid search, answers, visual refresh, image picker + URL field — shipped on `main`)

## Overview

Phase 7 uses Gemma 4 to enrich cards at capture time. When you attach an
image, Gemma 4 (which is vision-capable) describes it; when you opt in for a
URL, LocalGold fetches the page and Gemma summarizes it. In both cases the
result is a short description plus suggested tags, dropped into the editable
Capture fields before you save.

## Goals

- Make image-only and link cards searchable: an image gets a text description,
  a URL gets a summary — so semantic search and ⌘+Enter answers can use them.
- Suggest, never impose: enrichment pre-fills editable fields; the user reviews
  and saves.
- Never block capture: enrichment runs in the background; Ollama or network
  failure degrades silently.

## Non-Goals

- Enriching plain text-only cards (the user's own note is already the content).
- Re-enriching existing cards in bulk (enrichment happens at capture time).
- A browsing agent — URL enrichment fetches one page, nothing more.
- Streaming the enrichment result (it is small; a single call suffices).

## Interaction Model

- **Image enrichment is automatic.** Attaching an image (paste or picker)
  triggers a background description — an image has no other searchable text.
- **URL enrichment is opt-in.** A checkbox beside the URL field, **off by
  default** (the user's note is usually the synthesis; the URL just rides along
  as a source). Ticking it, with a URL present, triggers enrichment.
- **Results are suggestions.** The description appends to the body; tags merge
  into the tags field. Both are editable; nothing is committed until save.
- **Ordering.** Enrichment fills the fields *before* save; the embedding is
  computed *after* save (Phase 2 backfill). The embedding therefore always
  reflects the enriched content — no special ordering code is needed.

## Where Enriched Content Goes

The description is appended to the **card body**, under a distinct Markdown
heading so it is visually separable from the user's own writing:

```
(the user's own note, if any)

## Image
<Gemma's description of the attached image>
```

`## Link` is used for URL enrichment. The description is ordinary body text:
it is FTS-indexed and embedded like the rest of the body.

Suggested tags are merged into the tags input, de-duplicated against whatever
tags the user already typed.

## Architecture

All AI and network work is in the main process; the renderer triggers it via
IPC. New code is isolated into focused modules.

### `ollama.ts` (extended)

Gains a **non-streaming structured completion**: a call that sends a prompt
(optionally with one or more images) and a JSON schema as Ollama's `format`,
and returns the parsed object. Gemma 4 supports vision and structured output,
so it returns `{ description, tags }` directly. `health`, `embed`, and `chat`
are unchanged.

### `webpage.ts` (new, main)

A single pure function `extractText(html: string): string` — removes
`<script>`/`<style>` blocks, strips remaining tags, decodes basic entities,
collapses whitespace, and truncates to a fixed maximum length. No dependency;
unit-testable.

### `enrich.ts` (new, main)

The enrichment orchestration. Exposes:

- `enrichImage(ollama, bytes): Promise<Enrichment>` — base64-encodes the image,
  prompts Gemma for a one-paragraph description and 3–6 tags.
- `enrichUrl(ollama, fetcher, url): Promise<Enrichment>` — uses `fetcher` to
  retrieve the page, `extractText` to reduce it, prompts Gemma to summarize.

`Enrichment` is `{ description: string; tags: string[] }`. `enrich.ts` depends
on an injectable `Fetcher` (`(url) => Promise<string>`), so it is testable
with no network. Any failure — Ollama down, fetch error, unparseable output —
resolves to an empty `{ description: '', tags: [] }`, never a throw.

### `ipc.ts` (extended)

Two handlers: `enrich:image` (image bytes → `Enrichment`) and `enrich:url`
(URL string → `Enrichment`). Plain `ipcMain.handle` — the payload is small.

### `preload` (extended)

`enrichImage(data: Uint8Array): Promise<Enrichment>` and
`enrichUrl(url: string): Promise<Enrichment>`.

### `capture.ts` (extended)

- On image attach (paste or picker), call `enrichImage` in the background.
- A URL-enrichment checkbox (default off); when checked with a URL present,
  call `enrichUrl`.
- On a result, append `## Image` / `## Link` + the description to the body
  textarea and merge the tags into the tags input.
- A small inline status line reflects progress ("Describing image…") and
  clears when done; an unavailable result shows a brief notice.

### Shared types

`Enrichment` is added to `src/shared/types.ts`.

## Data Flow

```
attach image ─► enrichImage(bytes) ─► ollama (gemma4:e4b, vision, JSON format)
                                          └─► { description, tags } ─► body + tags fields

tick URL box ─► enrichUrl(url) ─► fetch(url) ─► extractText(html)
                                                   └─► ollama (gemma4:e4b, JSON format)
                                                          └─► { description, tags } ─► body + tags
```

The URL fetch is LocalGold's only outbound network request, and it happens
**only** when the user ticks the URL-enrichment checkbox. Capture, search,
embeddings, and answers remain local.

## The Model Request

Both enrichers ask `gemma4:e4b` for the same structured shape, using Ollama's
JSON-schema `format` so the response parses deterministically:

```json
{ "description": "<one concise paragraph>", "tags": ["<3-6 lowercase tags>"] }
```

- Image: the prompt instructs a factual visual description; the image bytes
  are attached (base64).
- URL: the prompt instructs a summary of the supplied page text.

The fetched page text is truncated by `extractText` before being sent, to keep
the prompt within a sane size.

## Error Handling

- **Ollama unreachable / model error** — `enrich*` returns an empty
  `Enrichment`; the Capture fields are untouched; the status line shows
  "Enrichment unavailable". Capture and save are unaffected.
- **URL fetch fails** (offline, non-200, timeout ~8s, non-HTML) — empty
  `Enrichment`; the URL is still saved as the card's `url`.
- **Unparseable model output** — empty `Enrichment`; no partial text is
  inserted.
- **User saves before enrichment returns** — the card saves without the
  enrichment; the in-flight result is simply discarded.

## Testing

- **`webpage.ts` `extractText`** — pure unit tests: `<script>`/`<style>`
  content removed, tags stripped, entities decoded, whitespace collapsed,
  output truncated at the maximum length.
- **`enrich.ts`** — with a fake structured-completion client and a fake
  `Fetcher`: `enrichImage` and `enrichUrl` produce the parsed
  `{ description, tags }`; a client or fetcher that throws yields an empty
  `Enrichment` rather than raising.
- The Ollama structured call, the two IPC handlers, and the Capture wiring are
  glue — verified in the `npm run dev` GUI pass: attaching an image fills a
  `## Image` description and tags; ticking the URL box fills a `## Link`
  summary; with Ollama stopped, capture still works and the status line says
  enrichment is unavailable.
- The full `npm test` suite must continue to pass.
