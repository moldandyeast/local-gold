# LocalGold Phase 10 — Screenshots with Annotation + Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 📸 Screenshot button to Capture that uses macOS `screencapture` to grab a region, opens a modal annotation editor (pen / arrow / rectangle + undo + optional voice), and saves the result as a card image attachment plus optional audio.

**Architecture:** A new `screenshot.ts` (main) wraps `screencapture -i`. A new `annotate.ts` (renderer) renders a fullscreen modal with a canvas and tools, reusing the Phase 8 voice pipeline for in-modal recording. `capture.ts` wires the button and merges the annotator's output (flattened PNG + audios + voice transcript/tags) into the existing capture state.

**Tech Stack:** Electron, TypeScript, macOS `screencapture`, HTML5 Canvas, MediaRecorder + Web Audio (renderer), Vitest.

---

## File Structure

```
src/
  main/screenshot.ts     — CREATE: captureScreenshot()
  main/ipc.ts            — MODIFY: screenshot:capture handler + window hide/show
  preload/index.ts       — MODIFY: expose captureScreenshot()
  renderer/shapes.ts     — CREATE: arrowhead pure helper
  renderer/annotate.ts   — CREATE: modal + canvas + tools + voice
  renderer/capture.ts    — MODIFY: 📸 Screenshot button, merge annotator result
  renderer/styles.css    — MODIFY: modal/toolbar/canvas styles
test/
  screenshot.test.ts     — CREATE
  shapes.test.ts         — CREATE
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as prior phases).

---

## Task 1: Screenshot main module

**Files:**
- Create: `src/main/screenshot.ts`
- Test: `test/screenshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/screenshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { captureScreenshot } from '../src/main/screenshot';

describe('captureScreenshot', () => {
  it('returns the PNG bytes when the spawn writes a file', async () => {
    const fakeSpawn = async (_cmd: string, args: string[]): Promise<void> => {
      const path = args[args.length - 1];
      writeFileSync(path, new Uint8Array([1, 2, 3, 4]));
    };
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result!)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when the spawn writes no file (user cancelled)', async () => {
    const fakeSpawn = async (): Promise<void> => undefined;
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeNull();
  });

  it('returns null when the spawn throws', async () => {
    const fakeSpawn = async (): Promise<void> => {
      throw new Error('no such command');
    };
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/screenshot.test.ts`
Expected: FAIL — cannot resolve `../src/main/screenshot`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/screenshot.ts`:

```ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/** Spawn an external process to completion. Injectable for tests. */
export type Spawn = (cmd: string, args: string[]) => Promise<void>;

const defaultSpawn: Spawn = async (cmd, args) => {
  await execFileAsync(cmd, args);
};

/**
 * Run macOS `screencapture -i <tempfile>` and read the resulting PNG.
 * Returns `null` if the user cancelled (no file produced) or the spawn fails.
 */
export async function captureScreenshot(
  spawn: Spawn = defaultSpawn
): Promise<Uint8Array | null> {
  const path = join(tmpdir(), `lg-screenshot-${Date.now()}.png`);
  try {
    await spawn('screencapture', ['-i', path]);
  } catch {
    return null;
  }
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return null;
  }
  await unlink(path).catch(() => undefined);
  return new Uint8Array(buf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/screenshot.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/screenshot.ts test/screenshot.test.ts
git commit -m "feat: add screencapture wrapper"
```

---

## Task 2: Screenshot IPC + preload

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add the IPC handler**

In `src/main/ipc.ts`, change the Electron import:

```ts
import { app, ipcMain, dialog, shell } from 'electron';
```

to:

```ts
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
```

Add this import alongside the other `./` imports:

```ts
import { captureScreenshot } from './screenshot';
```

Add this handler inside `registerIpc`, after the `dialog:pick-folder` handler:

```ts
  ipcMain.handle('screenshot:capture', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.hide();
    try {
      return await captureScreenshot();
    } finally {
      win?.show();
    }
  });
```

- [ ] **Step 2: Expose `captureScreenshot` in the preload bridge**

In `src/preload/index.ts`, add this method to the `LocalGoldApi` interface
(after `pickFolder`):

```ts
  captureScreenshot(): Promise<Uint8Array | null>;
```

And add this property to the `api` object (after `pickFolder`):

```ts
  captureScreenshot: () => ipcRenderer.invoke('screenshot:capture'),
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: add screenshot capture IPC"
```

---

## Task 3: Arrowhead geometry helper

**Files:**
- Create: `src/renderer/shapes.ts`
- Test: `test/shapes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/shapes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arrowhead } from '../src/renderer/shapes';

describe('arrowhead', () => {
  it('places both head points at distance `size` from the tip', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(Math.hypot(head.left.x - 10, head.left.y)).toBeCloseTo(5);
    expect(Math.hypot(head.right.x - 10, head.right.y)).toBeCloseTo(5);
  });

  it('places head points symmetric across the line', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 10, y: 0 }, 5);
    expect(head.left.x).toBeCloseTo(head.right.x);
    expect(head.left.y).toBeCloseTo(-head.right.y);
  });

  it('handles a vertical line', () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 0, y: 10 }, 5);
    expect(Math.hypot(head.left.x, head.left.y - 10)).toBeCloseTo(5);
    expect(Math.hypot(head.right.x, head.right.y - 10)).toBeCloseTo(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shapes.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/shapes`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/shapes.ts`:

```ts
export interface Point {
  x: number;
  y: number;
}

/** A drawn annotation shape on the canvas. */
export interface Shape {
  tool: 'pen' | 'arrow' | 'rect';
  /** Pen: every captured point. Arrow / rect: [start, end]. */
  points: Point[];
}

/** Two endpoints of an arrowhead at `b`, swept back along the line from a → b. */
export function arrowhead(
  a: Point,
  b: Point,
  size: number
): { left: Point; right: Point } {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = Math.PI / 6;
  return {
    left: {
      x: b.x - size * Math.cos(angle - spread),
      y: b.y - size * Math.sin(angle - spread)
    },
    right: {
      x: b.x - size * Math.cos(angle + spread),
      y: b.y - size * Math.sin(angle + spread)
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shapes.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shapes.ts test/shapes.test.ts
git commit -m "feat: add arrowhead geometry helper"
```

---

## Task 4: Annotation modal

**Files:**
- Create: `src/renderer/annotate.ts`

- [ ] **Step 1: Write the module**

Create `src/renderer/annotate.ts`:

```ts
import type { Enrichment } from '../shared/types';
import { decodeToPCM16k } from './audio';
import { arrowhead, type Point, type Shape } from './shapes';

/** What `openAnnotator` returns on Done. */
export interface AnnotatorResult {
  /** Flattened PNG of image + drawn shapes. */
  image: Uint8Array;
  /** Voice note(s) recorded in the modal (0 or 1). */
  audios: { name: string; data: Uint8Array }[];
  /** Voice transcript to append under `## Voice` (empty if no voice). */
  voiceBody: string;
  /** Tags suggested from the voice transcript. */
  voiceTags: string[];
}

const STROKE = '#EC9494'; // --problem
const WIDTH = 3;
const ARROW_HEAD = 14;

/**
 * Mount a fullscreen annotation modal over `document.body`. Resolves with the
 * flattened PNG + any voice on Done, or `null` on Cancel.
 */
export function openAnnotator(imageBytes: Uint8Array): Promise<AnnotatorResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'annot-overlay';
    overlay.innerHTML = `
      <div class="annot-toolbar">
        <button class="tool active" data-tool="pen">Pen</button>
        <button class="tool" data-tool="arrow">Arrow</button>
        <button class="tool" data-tool="rect">Rect</button>
        <button class="tool" id="undo">Undo</button>
        <button class="tool" id="record">🎙 Record</button>
        <span id="annot-status" class="hint"></span>
        <span class="spacer"></span>
        <button class="secondary" id="cancel">Cancel</button>
        <button class="primary" id="done">Done</button>
      </div>
      <div class="annot-canvas-wrap">
        <canvas id="annot-canvas"></canvas>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector<HTMLCanvasElement>('#annot-canvas')!;
    const ctx = canvas.getContext('2d')!;
    const statusEl = overlay.querySelector<HTMLSpanElement>('#annot-status')!;
    const recordBtn = overlay.querySelector<HTMLButtonElement>('#record')!;

    let tool: Shape['tool'] = 'pen';
    const shapes: Shape[] = [];
    let drawing: Shape | null = null;
    const audios: AnnotatorResult['audios'] = [];
    let voiceBody = '';
    let voiceTags: string[] = [];
    let recorder: MediaRecorder | null = null;
    let recordChunks: Blob[] = [];

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      render();
    };
    img.src = URL.createObjectURL(new Blob([imageBytes as BlobPart], { type: 'image/png' }));

    function render(): void {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of shapes) drawShape(s);
      if (drawing) drawShape(drawing);
    }

    function drawShape(s: Shape): void {
      if (s.tool === 'pen') {
        if (s.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i += 1) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      } else if (s.tool === 'arrow') {
        const [a, b] = s.points;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const head = arrowhead(a, b, ARROW_HEAD);
        ctx.beginPath();
        ctx.moveTo(head.left.x, head.left.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(head.right.x, head.right.y);
        ctx.stroke();
      } else {
        const [a, b] = s.points;
        ctx.strokeRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y)
        );
      }
    }

    // Tool buttons
    overlay.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tool = btn.dataset.tool as Shape['tool'];
        overlay
          .querySelectorAll<HTMLButtonElement>('.tool[data-tool]')
          .forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    overlay.querySelector<HTMLButtonElement>('#undo')!.addEventListener('click', () => {
      shapes.pop();
      render();
    });

    // Drawing on the canvas
    function toCanvas(e: PointerEvent): Point {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = toCanvas(e);
      drawing = tool === 'pen' ? { tool, points: [p] } : { tool, points: [p, p] };
      render();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toCanvas(e);
      if (drawing.tool === 'pen') drawing.points.push(p);
      else drawing.points[1] = p;
      render();
    });
    canvas.addEventListener('pointerup', () => {
      if (!drawing) return;
      shapes.push(drawing);
      drawing = null;
      render();
    });

    // Voice (mirrors Phase 8 capture flow; one take per modal)
    recordBtn.addEventListener('click', async () => {
      if (recorder) {
        recorder.stop();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        statusEl.textContent = 'Microphone unavailable.';
        return;
      }
      recordChunks = [];
      const rec = new MediaRecorder(stream);
      rec.addEventListener('dataavailable', (e) => recordChunks.push(e.data));
      rec.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        recordBtn.textContent = '🎙 Re-record';
        const type = recordChunks[0]?.type || 'audio/webm';
        const blob = new Blob(recordChunks, { type });
        const data = new Uint8Array(await blob.arrayBuffer());
        // Replace any prior take.
        audios.length = 0;
        audios.push({ name: 'voice.webm', data });
        statusEl.textContent = 'Transcribing voice…';
        let transcript = '';
        try {
          const samples = await decodeToPCM16k(blob);
          transcript = await window.localgold.transcribe(samples, 16000);
        } catch {
          transcript = '';
        }
        if (!transcript) {
          voiceBody = '';
          voiceTags = [];
          statusEl.textContent = 'Transcription unavailable.';
          return;
        }
        voiceBody = transcript;
        statusEl.textContent = 'Tagging transcript…';
        const enr: Enrichment = await window.localgold.enrichText(transcript);
        voiceTags = enr.tags;
        statusEl.textContent = '';
      });
      rec.start();
      recorder = rec;
      recordBtn.textContent = '⏹ Stop';
    });

    overlay.querySelector<HTMLButtonElement>('#cancel')!.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.querySelector<HTMLButtonElement>('#done')!.addEventListener('click', () => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          cleanup();
          resolve(null);
          return;
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        cleanup();
        resolve({ image: data, audios, voiceBody, voiceTags });
      }, 'image/png');
    });

    function cleanup(): void {
      if (recorder) recorder.stop();
      overlay.remove();
    }
  });
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/annotate.ts
git commit -m "feat: add annotation modal with pen/arrow/rect + voice"
```

---

## Task 5: Capture wire-up + styles

**Files:**
- Modify: `src/renderer/capture.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Add the 📸 Screenshot button to the Capture markup**

In `src/renderer/capture.ts`, find this block in the `host.innerHTML`
template:

```html
    <div class="row">
      <button class="secondary record" id="record">🎙 Record</button>
      <span id="record-timer" class="hint"></span>
    </div>
```

Add a new row right above it:

```html
    <div class="row">
      <button class="secondary" id="screenshot">📸 Screenshot</button>
      <span class="hint">capture a region, annotate, optionally narrate</span>
    </div>
    <div class="row">
      <button class="secondary record" id="record">🎙 Record</button>
      <span id="record-timer" class="hint"></span>
    </div>
```

- [ ] **Step 2: Import the annotator and wire the button**

In `src/renderer/capture.ts`, add this import after the existing imports:

```ts
import { openAnnotator } from './annotate';
```

Add this block after the existing `#pick` button click handler:

```ts
  host.querySelector<HTMLButtonElement>('#screenshot')!.addEventListener('click', async () => {
    const png = await window.localgold.captureScreenshot();
    if (!png) return;
    const result = await openAnnotator(png);
    if (!result) return;
    addImage('screenshot.png', result.image);
    for (const aud of result.audios) {
      audios.push(aud);
      addAudioChip(aud.name);
    }
    if (result.voiceBody) {
      const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
      body.value = `${prefix}## Voice\n${result.voiceBody}`;
    }
    mergeTags(result.voiceTags);
  });
```

- [ ] **Step 3: Add modal / toolbar / canvas styles**

Append to `src/renderer/styles.css`:

```css
.annot-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 10, 0.92);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}
.annot-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.annot-toolbar .spacer { flex: 1; }
.annot-toolbar .tool {
  padding: 6px 12px;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.annot-toolbar .tool.active {
  color: var(--primary);
  border-color: var(--primary);
}
.annot-canvas-wrap {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
#annot-canvas {
  max-width: 100%;
  max-height: 100%;
  background: #fff;
  border: 1px solid var(--border);
  cursor: crosshair;
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/capture.ts src/renderer/styles.css
git commit -m "feat: wire screenshot + annotate into capture view"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, including the new `screenshot` and `shapes`
suites.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the running app**

Run: `npm run rebuild && npm run dev`

In **Capture**:
- Click **📸 Screenshot**. The LocalGold window hides briefly; the macOS
  selector appears. Drag a region (or hit ␣ to grab a window). The
  Annotation modal opens with your screenshot on the canvas.
- Try **Pen** (scribble), **Arrow** (drag from one place to another) and
  **Rect** (drag a corner). Use **Undo** to pop the last shape.
- Click **🎙 Record**, say a short sentence, click **⏹ Stop**. The status
  flips through "Transcribing voice…" → "Tagging transcript…" → cleared.
- Click **Done**. The modal closes. Back in Capture, the screenshot
  thumbnail appears, an audio chip appears, the body has a `## Voice`
  transcript (and a `## Image` description once image enrichment finishes),
  and tags from both the transcript and the image have merged.
- Click **Save card**. Open **Library** — the new card shows the annotated
  screenshot's `▶ Play` audio affordance.
- Try **📸 Screenshot → Cancel** — nothing changes in Capture.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 10 complete — screenshots with annotation and voice" --allow-empty
```

---

## Phase 10 Done

LocalGold can now grab a screen region with the native macOS selector, mark
it up with pen / arrow / rectangle + undo, and record a voice note alongside
— all in one focused modal. The screenshot becomes a card image attachment
(running through Phase 7 image enrichment), the audio becomes a card audio
attachment (running through Phase 8 transcription + tagging), and both join
the existing capture flow. The test suite passes.
