# LocalGold Phase 8 — Voice Notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record voice notes in Capture, transcribe them locally with Whisper, append the transcript under `## Voice`, and auto-suggest tags from the transcript — keeping the audio file as a card attachment.

**Architecture:** A new `transcribe.ts` defines a `Transcriber` seam and a concrete `@huggingface/transformers` Whisper implementation that runs as ONNX/WASM (no native build). `enrich.ts` gains `enrichText` for tag-only enrichment. `store.ts` accepts a parallel `audios` array on `NewCard` and writes the files into the existing `attachments/` folder. The renderer adds a Record button (MediaRecorder) and a tiny PCM decoder; the Library plays audio via a new attachment-read IPC.

**Tech Stack:** Electron, TypeScript, MediaRecorder + Web Audio (renderer), `@huggingface/transformers` (Whisper-base.en, ONNX/WASM), Ollama (gemma4:e4b for tags), Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: audios? on NewCard
  main/store.ts          — MODIFY: write audio attachments
  main/transcribe.ts     — CREATE: Transcriber seam + Whisper impl
  main/enrich.ts         — MODIFY: enrichText
  main/ipc.ts            — MODIFY: transcribe:audio, enrich:text, read:attachment
  preload/index.ts       — MODIFY: transcribe / enrichText / readAttachment
  renderer/audio.ts      — CREATE: decodeToPCM16k(blob)
  renderer/capture.ts    — REWRITE: Record button + record/transcribe flow
  renderer/library.ts    — MODIFY: ▶ Play affordance on audio cards
  renderer/styles.css    — MODIFY: record + play styles
package.json             — MODIFY: add @huggingface/transformers
test/
  store.test.ts          — MODIFY: audios attachment test
  transcribe.test.ts     — CREATE
  enrich.test.ts         — MODIFY: enrichText tests
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as prior phases).

---

## Task 1: `audios` on `NewCard` + store writes audio attachments

**Files:**
- Modify: `src/shared/types.ts`, `src/main/store.ts`
- Test: `test/store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.ts`:

```ts
describe('store: audios', () => {
  it('writes audio attachments alongside images', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    const card = await writeCard(root, {
      body: 'voice note',
      tags: [],
      images: [{ name: 'pic.png', data: new Uint8Array([9, 9, 9]) }],
      audios: [{ name: 'voice.webm', data: new Uint8Array([1, 2, 3, 4]) }]
    });
    expect(card.attachments).toHaveLength(2);
    const exts = card.attachments.map((a) => a.split('.').pop());
    expect(exts).toContain('png');
    expect(exts).toContain('webm');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/store.test.ts`
Expected: FAIL — `audios` is rejected by `NewCard` and not written.

- [ ] **Step 3: Add `audios` to `NewCard`**

In `src/shared/types.ts`, change the `NewCard` interface to add `audios`:

```ts
/** A card submitted from the renderer, before it is written to disk. */
export interface NewCard {
  body: string;
  tags: string[];
  images: { name: string; data: Uint8Array }[];
  url?: string;
  audios?: { name: string; data: Uint8Array }[];
}
```

- [ ] **Step 4: Write audio attachments in `store.ts`**

In `src/main/store.ts`, replace the image-writing block in `writeCard`:

```ts
  const attachments: string[] = [];
  for (let i = 0; i < input.images.length; i += 1) {
    const img = input.images[i];
    const ext = extname(img.name) || '.png';
    const rel = join('attachments', `${stem}-${i + 1}${ext}`);
    await writeFile(join(root, rel), Buffer.from(img.data));
    attachments.push(rel);
  }
```

with:

```ts
  const attachments: string[] = [];
  let n = 0;
  for (const img of input.images) {
    n += 1;
    const ext = extname(img.name) || '.png';
    const rel = join('attachments', `${stem}-${n}${ext}`);
    await writeFile(join(root, rel), Buffer.from(img.data));
    attachments.push(rel);
  }
  for (const aud of input.audios ?? []) {
    n += 1;
    const ext = extname(aud.name) || '.webm';
    const rel = join('attachments', `${stem}-${n}${ext}`);
    await writeFile(join(root, rel), Buffer.from(aud.data));
    attachments.push(rel);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS — all `store` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/store.ts test/store.test.ts
git commit -m "feat: accept audio attachments in NewCard"
```

---

## Task 2: Transcriber seam + Whisper impl

**Files:**
- Create: `src/main/transcribe.ts`
- Test: `test/transcribe.test.ts`
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the Whisper runtime**

Run: `npm install @huggingface/transformers`
Expected: the package is added to `dependencies`.

- [ ] **Step 2: Write the failing tests**

Create `test/transcribe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runTranscription } from '../src/main/transcribe';

const goodTranscriber = {
  transcribe: async () => 'hello world'
};
const throwingTranscriber = {
  transcribe: async () => {
    throw new Error('whisper down');
  }
};

describe('runTranscription', () => {
  it('returns the transcribed text from the backend', async () => {
    expect(await runTranscription(goodTranscriber, new Float32Array(8), 16000)).toBe('hello world');
  });

  it('returns an empty string when the backend throws', async () => {
    expect(await runTranscription(throwingTranscriber, new Float32Array(8), 16000)).toBe('');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/transcribe.test.ts`
Expected: FAIL — cannot resolve `../src/main/transcribe`.

- [ ] **Step 4: Write the module**

Create `src/main/transcribe.ts`:

```ts
/**
 * A speech-to-text backend.
 * `samples` is mono PCM at `sampleRate` Hz (Whisper expects 16000).
 */
export interface Transcriber {
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
}

/**
 * Run a `Transcriber`, swallowing any error and returning '' instead.
 * Lets callers treat transcription as best-effort.
 */
export async function runTranscription(
  transcriber: Transcriber,
  samples: Float32Array,
  sampleRate: number
): Promise<string> {
  try {
    return await transcriber.transcribe(samples, sampleRate);
  } catch {
    return '';
  }
}

/**
 * The concrete Whisper backend, lazy-loaded from `@huggingface/transformers`.
 * The pipeline (model + tokenizer + ONNX runtime) is created once and reused.
 * The model (~145MB) downloads to the user's transformers cache on first use,
 * then runs offline.
 */
let pipelinePromise: Promise<(audio: Float32Array, opts?: unknown) => Promise<unknown>> | null =
  null;

async function getPipeline(): Promise<(audio: Float32Array, opts?: unknown) => Promise<unknown>> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const transformers = (await import('@huggingface/transformers')) as {
        pipeline: (task: string, model: string) => Promise<(audio: Float32Array, opts?: unknown) => Promise<unknown>>;
      };
      return transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
    })();
  }
  return pipelinePromise;
}

/** Build the Whisper-based `Transcriber`. */
export function createWhisperTranscriber(): Transcriber {
  return {
    async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
      const pipe = await getPipeline();
      const result = await pipe(samples, { sampling_rate: sampleRate });
      if (result && typeof result === 'object' && 'text' in result) {
        return String((result as { text: unknown }).text).trim();
      }
      return '';
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/transcribe.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/transcribe.ts test/transcribe.test.ts
git commit -m "feat: add Transcriber seam and Whisper implementation"
```

---

## Task 3: `enrichText` for tag suggestion over a transcript

**Files:**
- Modify: `src/main/enrich.ts`
- Test: `test/enrich.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/enrich.test.ts`:

```ts
import { enrichText } from '../src/main/enrich';

describe('enrichText', () => {
  it('returns the parsed tags from a completer', async () => {
    const result = await enrichText(goodCompleter, 'a recorded thought about pricing');
    expect(result.tags).toEqual(['one', 'two']);
  });

  it('returns an empty enrichment for a blank text', async () => {
    expect(await enrichText(goodCompleter, '   ')).toEqual({ description: '', tags: [] });
  });

  it('returns an empty enrichment when the completer throws', async () => {
    expect(await enrichText(throwingCompleter, 'something')).toEqual({
      description: '',
      tags: []
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/enrich.test.ts`
Expected: FAIL — `enrichText` is not exported.

- [ ] **Step 3: Add `enrichText` to `enrich.ts`**

Append to `src/main/enrich.ts`:

```ts
/**
 * Suggest tags (and optionally a short description) for a freeform text note,
 * e.g. a voice-note transcript. Returns an empty Enrichment on blank input or
 * any failure.
 */
export async function enrichText(ollama: Completer, text: string): Promise<Enrichment> {
  if (!text.trim()) return EMPTY;
  try {
    const result = await ollama.complete(
      'Read the following note and give 3-6 short lowercase topic tags. ' +
        'You may also include a short description. Respond as JSON.\n\nNote:\n' +
        text,
      { format: SCHEMA }
    );
    return coerce(result);
  } catch {
    return EMPTY;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/enrich.test.ts`
Expected: PASS — all `enrich` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/enrich.ts test/enrich.test.ts
git commit -m "feat: add enrichText for tag suggestion over a transcript"
```

---

## Task 4: IPC + preload — transcribe / enrich:text / read:attachment

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add the three handlers in `ipc.ts`**

In `src/main/ipc.ts`, add these imports after the existing imports:

```ts
import { enrichImage, enrichUrl, enrichText } from './enrich';
import { createWhisperTranscriber, runTranscription, type Transcriber } from './transcribe';
```

(Replace the existing `import { enrichImage, enrichUrl } from './enrich';` line — the new import line above includes `enrichText`.)

Add a lazy-init helper above `registerIpc` (after the `fetchPage` helper):

```ts
let transcriberInstance: Transcriber | null = null;
function getTranscriber(): Transcriber {
  if (!transcriberInstance) transcriberInstance = createWhisperTranscriber();
  return transcriberInstance;
}
```

Add these handlers inside `registerIpc`, after the `enrich:url` handler:

```ts
  ipcMain.handle('enrich:text', (_e, text: string) => enrichText(ollama, text));

  ipcMain.handle(
    'transcribe:audio',
    async (_e, samples: Float32Array, sampleRate: number) =>
      runTranscription(getTranscriber(), samples, sampleRate)
  );

  ipcMain.handle('read:attachment', async (_e, rel: string) => {
    const data = await readFile(join(root, rel));
    return new Uint8Array(data);
  });
```

- [ ] **Step 2: Expose the new methods in the preload bridge**

In `src/preload/index.ts`, add these methods to the `LocalGoldApi` interface
(after `enrichUrl`):

```ts
  enrichText(text: string): Promise<Enrichment>;
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
  readAttachment(rel: string): Promise<Uint8Array>;
```

And add these properties to the `api` object (after `enrichUrl`):

```ts
  enrichText: (text) => ipcRenderer.invoke('enrich:text', text),
  transcribe: (samples, sampleRate) => ipcRenderer.invoke('transcribe:audio', samples, sampleRate),
  readAttachment: (rel) => ipcRenderer.invoke('read:attachment', rel),
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: expose transcribe, enrich:text and read:attachment IPCs"
```

---

## Task 5: Renderer audio helper + Capture record flow

**Files:**
- Create: `src/renderer/audio.ts`
- Rewrite: `src/renderer/capture.ts`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Create `src/renderer/audio.ts`**

```ts
/**
 * Decode an audio Blob (any browser-supported format) into mono 16 kHz PCM,
 * the shape Whisper expects. Uses Web Audio in the renderer — runs at
 * decode-once cost, then off to the main process for transcription.
 */
export async function decodeToPCM16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(buffer.slice(0));
  } finally {
    void decodeCtx.close();
  }
  const target = 16000;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * target),
    target
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
```

- [ ] **Step 2: Replace the entire contents of `src/renderer/capture.ts`**

```ts
import type { Enrichment, NewCard } from '../shared/types';
import { decodeToPCM16k } from './audio';

/** Render the capture view into `host`. */
export function renderCapture(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Capture</h2>
    <textarea id="body" placeholder="Write an insight…"></textarea>
    <input id="tags" type="text" placeholder="tags, comma, separated" />
    <input id="url" type="text" placeholder="https://…  (optional)" />
    <div class="row">
      <input type="checkbox" id="enrich-url" />
      <label for="enrich-url">Summarise the linked page</label>
    </div>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <button class="secondary" id="pick">Choose images…</button>
      <span class="hint">or paste an image</span>
    </div>
    <div class="row">
      <button class="secondary record" id="record">🎙 Record</button>
      <span id="record-timer" class="hint"></span>
    </div>
    <button class="primary" id="save">Save card</button>
    <span id="status" class="hint"></span>
    <div id="enrich-status" class="hint"></div>
  `;

  const body = host.querySelector<HTMLTextAreaElement>('#body')!;
  const tags = host.querySelector<HTMLInputElement>('#tags')!;
  const url = host.querySelector<HTMLInputElement>('#url')!;
  const thumbs = host.querySelector<HTMLDivElement>('#thumbs')!;
  const status = host.querySelector<HTMLSpanElement>('#status')!;
  const enrichBox = host.querySelector<HTMLInputElement>('#enrich-url')!;
  const enrichStatus = host.querySelector<HTMLDivElement>('#enrich-status')!;
  const recordBtn = host.querySelector<HTMLButtonElement>('#record')!;
  const timerEl = host.querySelector<HTMLSpanElement>('#record-timer')!;

  const images: NewCard['images'] = [];
  const audios: NonNullable<NewCard['audios']> = [];
  let lastEnrichedUrl = '';
  let recorder: MediaRecorder | null = null;
  let recordStart = 0;
  let recordTimer: number | undefined;

  function applyEnrichment(heading: string, enr: Enrichment): void {
    if (enr.description) {
      const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
      body.value = `${prefix}## ${heading}\n${enr.description}`;
    }
    mergeTags(enr.tags);
  }

  function mergeTags(newTags: string[]): void {
    if (newTags.length === 0) return;
    const current = tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of newTags) if (!current.includes(t)) current.push(t);
    tags.value = current.join(', ');
  }

  function addImage(name: string, data: Uint8Array): void {
    images.push({ name, data });
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([data as BlobPart]));
    thumbs.appendChild(img);
    enrichStatus.textContent = 'Describing image…';
    void window.localgold.enrichImage(data).then((enr) => {
      applyEnrichment('Image', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
  }

  function addAudio(name: string, blob: Blob): void {
    const chip = document.createElement('span');
    chip.className = 'audio-chip';
    chip.textContent = `🎙 ${name}`;
    thumbs.appendChild(chip);
  }

  function maybeEnrichUrl(): void {
    const value = url.value.trim();
    if (!enrichBox.checked || !value || value === lastEnrichedUrl) return;
    lastEnrichedUrl = value;
    enrichStatus.textContent = 'Reading the page…';
    void window.localgold.enrichUrl(value).then((enr) => {
      applyEnrichment('Link', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
  }

  async function processRecording(blob: Blob): Promise<void> {
    const data = new Uint8Array(await blob.arrayBuffer());
    const name = 'voice.webm';
    audios.push({ name, data });
    addAudio(name, blob);
    enrichStatus.textContent = 'Transcribing voice…';
    let transcript = '';
    try {
      const samples = await decodeToPCM16k(blob);
      transcript = await window.localgold.transcribe(samples, 16000);
    } catch {
      transcript = '';
    }
    if (!transcript) {
      enrichStatus.textContent = 'Transcription unavailable.';
      return;
    }
    const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
    body.value = `${prefix}## Voice\n${transcript}`;
    enrichStatus.textContent = 'Tagging transcript…';
    const enr = await window.localgold.enrichText(transcript);
    mergeTags(enr.tags);
    enrichStatus.textContent = '';
  }

  async function startRecording(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      enrichStatus.textContent = 'Microphone unavailable.';
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.addEventListener('dataavailable', (e) => chunks.push(e.data));
    rec.addEventListener('stop', () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = chunks[0]?.type || 'audio/webm';
      void processRecording(new Blob(chunks, { type }));
    });
    rec.start();
    recorder = rec;
    recordBtn.textContent = '⏹ Stop';
    recordBtn.classList.add('recording');
    recordStart = Date.now();
    timerEl.textContent = '0:00';
    recordTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - recordStart) / 1000);
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }

  function stopRecording(): void {
    if (!recorder) return;
    recorder.stop();
    recorder = null;
    window.clearInterval(recordTimer);
    recordBtn.textContent = '🎙 Record';
    recordBtn.classList.remove('recording');
    timerEl.textContent = '';
  }

  enrichBox.addEventListener('change', maybeEnrichUrl);
  url.addEventListener('change', maybeEnrichUrl);

  body.addEventListener('paste', async (e) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      addImage(file.name || `pasted.${item.type.split('/')[1] || 'png'}`, data);
    }
  });

  host.querySelector<HTMLButtonElement>('#pick')!.addEventListener('click', async () => {
    const picked = await window.localgold.pickImages();
    for (const img of picked) addImage(img.name, img.data);
  });

  recordBtn.addEventListener('click', () => {
    if (recorder) stopRecording();
    else void startRecording();
  });

  host.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', async () => {
    const text = body.value.trim();
    if (!text) {
      status.textContent = 'Nothing to save.';
      status.className = 'hint';
      return;
    }
    const tagList = tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const urlValue = url.value.trim();
    await window.localgold.createCard({
      body: text,
      tags: tagList,
      images,
      audios,
      url: urlValue || undefined
    });
    body.value = '';
    tags.value = '';
    url.value = '';
    images.length = 0;
    audios.length = 0;
    thumbs.innerHTML = '';
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
```

- [ ] **Step 3: Add record + audio-chip styles**

Append to `src/renderer/styles.css`:

```css
.record.recording { color: var(--problem); border-color: var(--problem); }
.audio-chip {
  display: inline-block;
  font-size: 11px;
  color: var(--fg-muted);
  background: #232323;
  border-radius: var(--radius);
  padding: 2px 8px;
  margin-right: 6px;
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/audio.ts src/renderer/capture.ts src/renderer/styles.css
git commit -m "feat: record + transcribe voice notes from capture"
```

---

## Task 6: Library — ▶ Play affordance for audio attachments

**Files:**
- Modify: `src/renderer/library.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Add audio detection and a Play button in `cardHtml`**

In `src/renderer/library.ts`, replace `cardHtml`:

```ts
function cardHtml(card: Card, snippet?: string): string {
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const text = snippet
    ? escapeHtml(snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')
    : escapeHtml(card.body.slice(0, 240));
  const audios = card.attachments
    .filter((a) => /\.(webm|m4a|mp3|wav|ogg)$/i.test(a))
    .map(
      (a) =>
        `<button class="play" data-rel="${escapeHtml(a)}">▶ Play</button>`
    )
    .join('');
  const imageCount = card.attachments.filter((a) => !/\.(webm|m4a|mp3|wav|ogg)$/i.test(a)).length;
  const imageMeta = imageCount
    ? `<div class="meta">${imageCount} image(s) attached</div>`
    : '';
  return `<div class="card" data-card-id="${escapeHtml(card.id)}">
    <div class="meta">${escapeHtml(card.created)}</div>
    <div>${text}</div>
    <div>${tags}</div>${imageMeta}${audios ? `<div class="audios">${audios}</div>` : ''}
  </div>`;
}
```

- [ ] **Step 2: Add a delegated click handler that plays audio**

In `src/renderer/library.ts`, inside `renderLibrary`, add a click handler on
`results` (alongside the existing `answerEl` click handler):

```ts
  results.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('play')) return;
    const rel = target.getAttribute('data-rel');
    if (!rel) return;
    const bytes = await window.localgold.readAttachment(rel);
    const audio = new Audio(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/webm' })));
    void audio.play();
  });
```

- [ ] **Step 3: Add the Play button style**

Append to `src/renderer/styles.css`:

```css
.audios { margin-top: 8px; }
.play {
  padding: 3px 9px;
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  margin-right: 6px;
}
.play:hover { border-color: var(--primary); }
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/library.ts src/renderer/styles.css
git commit -m "feat: play audio attachments from the library"
```

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, including the new `transcribe` suite, the
appended `store` and `enrich` tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the running app**

Run: `npm run rebuild && npm run dev`

In Capture, click **🎙 Record** (grant microphone permission the first time);
the button flips to **⏹ Stop** with a running timer. Speak a sentence, then
click **⏹ Stop**.

- An audio chip appears in the attachments row.
- "Transcribing voice…" shows; on the **first ever** click the Whisper
  model downloads (~145 MB to the transformers cache; this can take a minute).
  Subsequent uses are offline.
- The transcript appears in the body under `## Voice`.
- "Tagging transcript…" shows briefly; suggested tags merge into the tags
  field.
- Save the card. In the Library, the card shows a **▶ Play** button — click
  it to hear your recording.

With Ollama stopped:
- Recording and transcription still work; tag suggestion is skipped.

With the mic blocked:
- The Record button shows "Microphone unavailable."; nothing else breaks.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 8 complete — voice notes" --allow-empty
```

---

## Phase 8 Done

Recording a voice note in Capture transcribes locally via Whisper, drops the
transcript into the body under `## Voice`, and suggests tags via Gemma 4 — and
the original audio persists on disk as a card attachment, playable from the
Library. The test suite passes.
