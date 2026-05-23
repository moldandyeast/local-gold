# LocalGold Phase 8 — Voice Notes — Design

**Date:** 2026-05-23
**Status:** Approved for planning
**Builds on:** Phases 1–7 (capture, hybrid search, answers, visual refresh, image picker + URL, AI enrichment — shipped on `main`)

## Overview

Phase 8 lets the user record voice notes from the Capture view. The audio is
saved as a card attachment alongside images; a local Whisper model transcribes
it in the background; the transcript is appended to the body under a `## Voice`
heading; and Gemma 4 suggests tags from the transcript — using the same
enrichment pattern as Phase 7. Everything stays local.

## Goals

- One-click voice capture from the existing Capture view.
- Local, offline transcription via Whisper — no cloud STT.
- The audio file persists with the card and is replayable from the Library.
- Tags are suggested from the transcript automatically, mergeable with what the
  user typed.
- Capture, save, and the rest of the app are never blocked by transcription or
  enrichment.

## Non-Goals

- Real-time/streaming transcription while recording (run after stop).
- Editing the audio (trim, split).
- A separate "voice notes" view — voice is just another way to populate a card.
- Speaker diarisation, translation, multi-language detection beyond Whisper's
  built-in capabilities.

## Interaction

- A **🎙 Record** button in Capture starts recording. It flips to **⏹ Stop**
  with a running mm:ss timer.
- On stop, the captured audio (`.webm` from `MediaRecorder`) becomes a pending
  attachment, shown as a small audio chip beside the image thumbnails.
- Transcription runs in the background. When it returns, the transcript is
  appended to the body under a `## Voice` heading (the same pattern as
  Phase 7's `## Image` / `## Link`).
- A tag pass on the transcript via Gemma 4 follows, merging suggested tags
  into the tags field.
- On save, the audio file is written to `attachments/` alongside any images;
  its path is added to the card's `attachments` array (no data-model change).
- In the Library, a card whose attachments include audio shows a small **▶
  Play** affordance that plays the audio in place.

## Architecture & Modules

### Transcription

- **`src/main/transcribe.ts`** (new) — defines a `Transcriber` interface
  (`transcribe(audio: Uint8Array): Promise<string>`) and one concrete
  implementation using **Whisper via `@huggingface/transformers`** (ONNX/WASM)
  with the **`Xenova/whisper-base.en`** model. WASM means no native build and
  no ABI rebuild dance (unlike `better-sqlite3`). The model (~145 MB)
  downloads to the user's transformers cache on first use and runs offline
  afterwards.
- The `Transcriber` seam lets a `whisper.cpp` (or Gemma audio) implementation
  drop in later without touching callers.
- Transcription never throws: on any failure it resolves to `''`.

### Enrichment (text)

- **`src/main/enrich.ts`** — gains `enrichText(ollama, text)`. Same JSON
  schema as the existing `enrichImage` / `enrichUrl`; the description field
  is ignored (the transcript itself *is* the description), only the tags are
  used by the caller.

### IPC

- **`src/main/ipc.ts`** — new handlers:
  - `transcribe:audio` (audio bytes → transcript string)
  - `enrich:text` (text → `Enrichment`)

### Preload

- **`src/preload/index.ts`** — `transcribe(data: Uint8Array): Promise<string>`
  and `enrichText(text: string): Promise<Enrichment>`.

### Storage

- **`src/main/store.ts`** — `writeCard` accepts an additional `audios` field
  on `NewCard` (same shape as `images`: `{ name, data }[]`) and writes each
  blob into `attachments/`, appending its relative path to the card's
  `attachments` array. The `Card` data model is unchanged — audio paths just
  live in the same `attachments` list, distinguished by extension.

### Renderer

- **`src/renderer/capture.ts`** — record/stop button + timer, `MediaRecorder`
  glue, audio appended to a new `audios` array (parallel to `images`),
  background `transcribe` → append `## Voice` + transcript to the body,
  background `enrichText` → merge tags. On save, both `images` and `audios`
  are sent to `createCard`.
- **`src/renderer/library.ts`** — for each card, if any attachment ends in an
  audio extension (`.webm`/`.m4a`/`.mp3`/`.wav`), render a small **▶ Play**
  button that plays it inline (an `<audio>` element pointing at a `file://`
  URL via Electron's standard local file access).

### Shared types

- **`src/shared/types.ts`** — `NewCard` gains `audios?: { name: string; data: Uint8Array }[]`.
- A small change to the `LocalGoldApi` to expose `transcribe` and `enrichText`.

### CSS

- A small addition for the record-button recording state and the audio chip /
  Play affordance, using only Phase 4 design-system tokens.

## Data Flow

```
Record click ─► MediaRecorder ─► Stop ─► audios.push(blob), show chip
                                            │
                                            ├─► transcribe(bytes) ─► append "## Voice\n<text>" to body
                                            │
                                            └─► enrichText(text) ─► merge tags into tags field

Save click ─► createCard({ body, tags, images, audios, url? })
                  └─► store writes each audio under attachments/<stem>-<n>.webm
                  └─► card.attachments includes the audio paths
```

The Whisper model fetch on first run is the only outbound network request for
voice notes; the spec calls that out explicitly so it isn't a surprise.

## Error Handling

- **Mic permission denied / no microphone** — Record button shows a brief
  "Microphone unavailable" hint; the rest of the app is unaffected.
- **`MediaRecorder` not supported** — same: the Record button is disabled with
  the hint.
- **Whisper model still downloading / load fails** — `transcribe` returns
  `''`; the audio attachment is still saved; an enrich status shows
  "Transcription unavailable"; the user can click a small **Transcribe**
  button on the audio chip to retry once the model is ready.
- **Tag enrichment fails** (Ollama down) — silently no tags; the transcript
  still appears (same pattern as Phase 7).
- **Save before transcription returns** — the card saves with the audio
  attached and the body as-is; the pending transcription is discarded.

## Testing

- **`transcribe.ts`** — with an injected fake Whisper backend: returns the
  backend's text; a throwing backend yields `''` (never throws).
- **`enrich.ts` `enrichText`** — with a fake completer: returns the parsed
  tags; coerces a malformed result to an empty list; a throwing completer
  yields empty.
- **`store.ts`** — `writeCard` with `audios` writes audio files into
  `attachments/` and the returned `Card.attachments` lists their paths
  alongside any images.
- The `MediaRecorder` glue, the IPC, the real Whisper run, the Play
  affordance, and the model first-download path are renderer/Electron glue
  with no unit tests — verified in the `npm run dev` GUI pass: record → stop →
  `## Voice` transcript appears → suggested tags merge in → save → re-open the
  card in Library and play the audio.
- The full `npm test` suite must continue to pass.
