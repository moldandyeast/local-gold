# LocalGold Phase 10 — Screenshots with Annotation + Voice — Design

**Date:** 2026-05-23
**Status:** Approved for planning
**Builds on:** Phases 1–9 (capture, hybrid search, answers, visual refresh, image picker + URL, AI enrichment, voice notes, data folder — shipped on `main`)

## Overview

Phase 10 lets the user capture a screen region, mark it up with simple
annotation tools (pen / arrow / rectangle), optionally talk through it, and
save the whole thing as a card. The screenshot becomes a flattened PNG image
attachment, the voice becomes an audio attachment whose transcript appends
under `## Voice` — both feed the existing AI enrichment pipeline.

## Goals

- Capture a region (or a window, or the full screen) using the native macOS
  selector.
- Annotate it with three tools — pen, arrow, rectangle — plus undo.
- Record a voice note in the same focused gesture.
- Reuse Phase 7 (image enrichment) and Phase 8 (transcribe + tag transcript)
  unchanged on the result.

## Non-Goals

- A full mini-Skitch (no text labels, no color picker, no shape edit
  handles, no crop).
- Editing past screenshots stored as card attachments.
- A global keyboard shortcut (deferred — Phase 1's global-shortcut decision
  applies here too).
- Cross-platform parity (this phase targets macOS via `screencapture`).

## Capture mechanism

The native `screencapture` CLI:

```
screencapture -i <tempfile.png>
```

`-i` is the interactive selector — drag a region, hit ␣ to grab a window,
hit ⎋ to cancel. We invoke it from the main process via `child_process` and
read the resulting PNG. If the user cancels, no file is produced; we return
`null` and the renderer is a no-op.

The LocalGold window is hidden just before the call and shown again after, so
the LocalGold UI is never accidentally in the shot.

## Annotation

The annotation modal is a renderer-side overlay (`<div class="modal">`
mounted to `document.body`), not a new BrowserWindow. It holds:

- A `<canvas>` rendering the loaded screenshot plus all drawn shapes.
- A small toolbar across the top: **Pen** · **Arrow** · **Rectangle** ·
  **Undo** · **🎙 Record** · **Done** · **Cancel**.
- A status line below the toolbar that mirrors Phase 7/8's enrichment-status
  pattern.

### Tools

- **Pen** — freehand polyline. Mouse-down starts a stroke; subsequent
  mouse-move adds points; mouse-up finishes it.
- **Arrow** — click-drag from start to end. Renders a line plus an arrowhead
  at the end point.
- **Rectangle** — click-drag corner to opposite corner. Renders a stroked
  rectangle.
- **Undo** — removes the most recent shape and re-renders.

Shapes are stored as vectors (`{ tool, points }` for pen and arrow;
`{ tool, start, end }` for rectangle) so undo is just `shapes.pop()` followed
by a redraw. The shape list is the source of truth; the canvas is just a
render of `image + shapes`.

### Style

One fixed annotation color, the design-system `--problem` red (`#EC9494`) —
high contrast on most UIs and consistent with the rest of the palette. One
fixed stroke width (3 CSS pixels, scaled to the image's native pixel ratio so
the strokes look right on retina screenshots). No color picker, no width
picker.

### Output

When the user clicks **Done**:

1. The canvas (image + shapes) is exported as PNG bytes via
   `canvas.toBlob('image/png')`.
2. The PNG bytes plus any recorded audio (see below) resolve the
   `openAnnotator(...)` promise.
3. The modal is removed from the DOM.

**Cancel** resolves with `null` (and discards the in-modal audio).

## Voice integration

The modal's **🎙 Record** button drives the same Phase 8 pipeline:

- `MediaRecorder` records `.webm` audio.
- On stop, the audio bytes go into a local `audios` array (parallel to the
  Capture view's).
- The Phase 5 audio decoder converts to 16 kHz PCM, the renderer calls
  `transcribe(...)`, the transcript appends to a *new in-modal body buffer*
  under `## Voice`, and `enrichText(transcript)` suggests tags.
- On **Done**, the in-modal body addition and suggested tags are merged into
  Capture's textarea/tags input — same merge helper Capture already uses for
  image and URL enrichment.

Multiple recordings in one modal are not supported in this phase: only one
voice note per screenshot. (Re-recording before Done replaces the prior take;
clear in the UI as the "Record" button becomes "Re-record" while a take is
pending.)

## Architecture

```
Capture ─ 📸 Screenshot ─► main: hide window
                          ─► screencapture -i tmpfile
                          ─► main: show window, read file
                          ─► renderer: openAnnotator(pngBytes)
                                       └─► canvas + shapes + (optional) audio
                                       └─► flatten → PNG bytes (+ audio bytes)
                                       └─► Capture: images.push + audios.push
                                                  (+ body/tags merged from any voice)
```

Existing flows continue:
- `images` array feeds Phase 7 `enrichImage` on attach — so Gemma 4
  describes the *annotated* screenshot.
- `audios` array feeds `writeCard` on save — the audio file is saved to
  `attachments/` alongside the image (Phase 8).

### New / changed files

- **`src/main/screenshot.ts`** (new) — `captureScreenshot(spawn?): Promise<Uint8Array | null>`.
  Pure unit-testable via an injected `spawn` function.
- **`src/main/ipc.ts`** — `screenshot:capture` handler, runs
  `captureScreenshot` between `mainWindow.hide()` / `mainWindow.show()`.
- **`src/preload/index.ts`** — `captureScreenshot(): Promise<Uint8Array | null>`.
- **`src/renderer/annotate.ts`** (new) — the modal, canvas, drawing logic,
  in-modal record pipeline; exports `openAnnotator(image): Promise<{ image, audios, voiceBody, voiceTags } | null>`.
- **`src/renderer/capture.ts`** — adds the 📸 Screenshot button; on click,
  calls `captureScreenshot` → `openAnnotator`, then merges results into the
  existing `images`, `audios`, body, and tags state.
- **`src/renderer/styles.css`** — modal overlay, toolbar, canvas, tool-button
  states (using existing design-system tokens).

## Data flow detail

`openAnnotator(image)` returns:

```ts
interface AnnotatorResult {
  /** Flattened PNG of image + annotation shapes. */
  image: Uint8Array;
  /** The voice note(s) recorded in the modal (0 or 1 in this phase). */
  audios: { name: string; data: Uint8Array }[];
  /** Voice transcript to append to the card body (empty string if none). */
  voiceBody: string;
  /** Tags suggested from the voice transcript. */
  voiceTags: string[];
}
```

`null` is returned on Cancel. Capture merges all four pieces using its
existing helpers (so the `## Voice` heading + tag merge work the same way as
the in-Capture record button does).

## Error handling

- **User cancels `screencapture`** — `captureScreenshot` returns `null`; the
  annotation modal never opens; nothing changes in Capture.
- **`screencapture` fails or is missing** (non-macOS, sandboxed) — IPC
  rejects; Capture shows a small status "Screenshot unavailable on this
  system."; capture/save continue to work.
- **Annotation modal Cancel** — discards image and any drawn shapes or
  recorded audio; no state change in Capture.
- **Mic permission denied in modal** — same Phase 8 hint "Microphone
  unavailable"; the screenshot can still be saved without voice.
- **`transcribe` / `enrichText` fail** — same Phase 8 silent fallback; the
  image attachment is unaffected.
- **Window hide/show race** — `mainWindow.hide()` is awaited so the window
  is gone before the picker; `show()` is in a `finally` so it always comes
  back even if `screencapture` throws.

## Testing

- **`screenshot.ts`** — with an injected spawn helper:
  - Returns the bytes the spawn writes (mock by writing a known file then
    invoking the function).
  - Returns `null` when the spawn exits without producing a file (cancel).
- **`annotate.ts`** — canvas + DOM glue; verified in the `npm run dev` GUI
  pass (see Step 3 of the implementation plan's verification task): take a
  region screenshot, draw an arrow and a rectangle, undo, record a voice
  note, hit Done; confirm the card is saved with the flattened PNG + the
  audio attachment and a `## Voice` transcript with suggested tags;
  Cancel discards.
- The full `npm test` suite must continue to pass.
