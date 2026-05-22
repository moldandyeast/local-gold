# LocalGold Phase 6 — Capture: Image Picker + URL Field — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Builds on:** Phases 1–4 (capture, hybrid search, answers, visual refresh — shipped on `main`)

## Overview

Phase 6 extends the Capture view with two requested inputs: a **"Choose
images…"** button that opens the native file picker (alongside the existing
paste-to-attach), and an optional **URL field** stored as a dedicated
frontmatter field on the card.

## Goals

- Attach images by browsing the filesystem, not only by pasting.
- Capture an optional source URL per card as a real, structured field.
- No change to search, answers, or existing capture behaviour (paste still
  works exactly as before).

## Non-Goals

- Multiple URLs per card (one optional `url`).
- Arbitrary non-image file attachments.
- URL validation, unfurling, or link previews.
- Indexing or embedding the URL (search stays over body + tags).

## Data Model

`Card` and `NewCard` gain an optional `url?: string`.

A card's Markdown frontmatter includes the `url` line **only when set**:

```yaml
---
id: 2026-05-22-a3f8c1d2
created: 2026-05-22T09:30:00Z
tags: [idea]
url: https://example.com/article
attachments: [attachments/2026-05-22-a3f8c1d2-1.png]
---
```

A card with no URL omits the line entirely. The URL is reference metadata: it
is **not** added to the FTS index and **not** embedded — semantic and keyword
search continue to operate over body + tags only.

The `index.db` `cards` table gains a `url` column (`TEXT NOT NULL DEFAULT ''`).
`index.db` remains a rebuildable cache; the new column is populated by the
existing rebuild from the Markdown files.

## Components

### Image picker

A **"Choose images…"** button in the Capture view, beside the existing
paste affordance.

- Clicking it sends a new `dialog:pick-images` IPC message.
- The main process runs `dialog.showOpenDialog` — filtered to image
  extensions, `multiSelections` enabled — reads each chosen file, and returns
  an array of `{ name, data }` (a filename and a `Uint8Array`), the exact
  shape the paste handler already produces.
- The renderer appends the returned items to the same in-memory `images`
  array used by paste and renders the same thumbnails.
- Cancelling the dialog returns an empty array; nothing changes.
- Paste-to-attach is untouched.

### URL field

A single text input in the Capture view, below the tags input, placeholder
`https://…  (optional)`.

- On save, the input's trimmed value, if non-empty, becomes the card's `url`.
- An empty value means the card has no `url`.
- No URL-format validation — the stored value is whatever was typed (trimmed).
- The field clears along with the rest of the form after a successful save.

## Architecture & Touched Files

- **`src/shared/types.ts`** — add `url?: string` to `Card` and `NewCard`.
- **`src/main/store.ts`** — `serializeCard` writes the `url` frontmatter line
  when present; `parseCard` reads it (absent → `url` omitted); `writeCard`
  carries `input.url` onto the stored `Card`.
- **`src/main/index-db.ts`** — add the `url` column to the `cards` table in
  `initSchema`; `upsertCard` writes it; `rowToCard` reads it.
- **`src/main/ipc.ts`** — add a `dialog:pick-images` handler
  (`dialog.showOpenDialog` → read files → `{ name, data }[]`).
- **`src/preload/index.ts`** — expose `pickImages(): Promise<{ name, data }[]>`.
- **`src/renderer/capture.ts`** — the "Choose images…" button wired to
  `pickImages()`, and the URL input; both feed `createCard`.

The Capture view's existing styling (Phase 4 design system) covers the new
button and input with no new CSS — they reuse `.primary`/input styles, with
the picker button using a muted secondary treatment.

## Error Handling

- **Dialog cancelled** — `dialog:pick-images` returns `[]`; no-op.
- **A chosen file fails to read** — it is skipped; the others still return.
  Capture is never blocked.
- **Existing cards without a `url`** — `parseCard` yields a card with no
  `url`; `index-db`'s `url` column defaults to `''`. Fully backward
  compatible; no migration needed (the index rebuilds from the files).

## Testing

- **`store.ts`** — round-trip a card **with** a `url` and a card **without**
  one through `serializeCard` → `parseCard`; confirm the line is present only
  when set; `writeCard` persists a provided `url`.
- **`index-db.ts`** — `upsertCard` then `getCard` preserves `url`; a card
  inserted without a `url` reads back with no `url`.
- The file dialog, the picker button, and the URL input are Electron/renderer
  glue with no unit tests (consistent with prior phases) — verified in the
  `npm run dev` GUI pass: choosing images via the dialog attaches them, and a
  saved URL appears in the card's `.md` frontmatter.
- The full `npm test` suite must continue to pass.
