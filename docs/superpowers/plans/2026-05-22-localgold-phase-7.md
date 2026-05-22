# LocalGold Phase 7 — AI Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At capture time, use Gemma 4 to describe attached images and (opt-in) summarize linked URLs, pre-filling the description into the body and tags into the tags field.

**Architecture:** A new `webpage.ts` reduces fetched HTML to text; a new `enrich.ts` orchestrates Gemma calls into a `{ description, tags }` result, depending on injectable `Completer`/`Fetcher` interfaces so it is testable offline. `ollama.ts` gains a non-streaming structured completion (images + JSON schema). Two IPC handlers expose it; `capture.ts` triggers enrichment in the background.

**Tech Stack:** Electron, TypeScript, Ollama (`/api/generate`, vision + JSON `format`), Gemma 4, Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: add Enrichment
  main/webpage.ts        — CREATE: extractText(html)
  main/ollama.ts         — MODIFY: add complete() structured call
  main/enrich.ts         — CREATE: enrichImage / enrichUrl
  main/ipc.ts            — MODIFY: enrich:image, enrich:url handlers
  preload/index.ts       — MODIFY: expose enrichImage / enrichUrl
  renderer/capture.ts    — REWRITE: background enrichment wiring
  renderer/styles.css    — MODIFY: checkbox-row label style
test/
  webpage.test.ts        — CREATE
  ollama.test.ts         — MODIFY: complete() tests
  enrich.test.ts         — CREATE
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as prior phases).

---

## Task 1: Enrichment type + webpage text extraction

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/webpage.ts`
- Test: `test/webpage.test.ts`

- [ ] **Step 1: Add the `Enrichment` shared type**

Append to `src/shared/types.ts`:

```ts
/** AI-generated enrichment for a card: a description and suggested tags. */
export interface Enrichment {
  description: string;
  tags: string[];
}
```

- [ ] **Step 2: Write the failing test**

Create `test/webpage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractText, MAX_PAGE_TEXT } from '../src/main/webpage';

describe('extractText', () => {
  it('strips tags and keeps text', () => {
    expect(extractText('<h1>Title</h1><p>Body text</p>')).toBe('Title Body text');
  });

  it('removes script and style content entirely', () => {
    const html = '<style>.x{color:red}</style><p>keep</p><script>alert(1)</script>';
    expect(extractText(html)).toBe('keep');
  });

  it('decodes basic HTML entities', () => {
    expect(extractText('<p>a &amp; b &lt;c&gt; &quot;d&quot;</p>')).toBe('a & b <c> "d"');
  });

  it('collapses runs of whitespace', () => {
    expect(extractText('<p>a\n\n   b\t c</p>')).toBe('a b c');
  });

  it('truncates to MAX_PAGE_TEXT characters', () => {
    const html = `<p>${'x'.repeat(MAX_PAGE_TEXT + 500)}</p>`;
    expect(extractText(html).length).toBe(MAX_PAGE_TEXT);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/webpage.test.ts`
Expected: FAIL — cannot resolve `../src/main/webpage`.

- [ ] **Step 4: Write minimal implementation**

Create `src/main/webpage.ts`:

```ts
/** Maximum characters of page text sent to the model. */
export const MAX_PAGE_TEXT = 6000;

/** Reduce raw HTML to plain readable text, collapsed and length-capped. */
export function extractText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > MAX_PAGE_TEXT) text = text.slice(0, MAX_PAGE_TEXT);
  return text;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/webpage.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/webpage.ts test/webpage.test.ts
git commit -m "feat: add Enrichment type and HTML text extraction"
```

---

## Task 2: Ollama structured completion

**Files:**
- Modify: `src/main/ollama.ts`
- Test: `test/ollama.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/ollama.test.ts`:

```ts
describe('ollama: complete', () => {
  it('parses a JSON response from /api/generate', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/generate') {
        res.end(JSON.stringify({ response: '{"description":"a cat","tags":["cat"]}' }));
      }
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    const result = await ollama.complete('describe', { format: { type: 'object' } });
    expect(result).toEqual({ description: 'a cat', tags: ['cat'] });
  });

  it('throws when generate returns a non-200', async () => {
    const url = await stubOllama((_reqUrl, res) => {
      res.statusCode = 500;
      res.end('err');
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    await expect(ollama.complete('describe')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ollama.test.ts`
Expected: FAIL — `ollama.complete` is not a function.

- [ ] **Step 3: Add `complete` to the Ollama client**

In `src/main/ollama.ts`, change the `Ollama` interface to add `complete`:

```ts
/** A local Ollama client: health check, embeddings, and streaming chat. */
export interface Ollama extends Embedder, Chatter {
  health(): Promise<OllamaStatus>;
  /** Non-streaming completion; with a JSON-schema `format`, returns parsed JSON. */
  complete(
    prompt: string,
    opts?: { images?: string[]; format?: unknown }
  ): Promise<unknown>;
}
```

Add this `complete` function inside `createOllama`, after `chat`:

```ts
  async function complete(
    prompt: string,
    opts: { images?: string[]; format?: unknown } = {}
  ): Promise<unknown> {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        prompt,
        images: opts.images,
        format: opts.format,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`Ollama generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as { response?: string };
    return JSON.parse(data.response ?? 'null');
  }
```

Change the return statement to include `complete`:

```ts
  return { health, embed, chat, complete };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ollama.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/ollama.ts test/ollama.test.ts
git commit -m "feat: add structured completion to Ollama client"
```

---

## Task 3: Enrichment orchestration

**Files:**
- Create: `src/main/enrich.ts`
- Test: `test/enrich.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/enrich.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { enrichImage, enrichUrl } from '../src/main/enrich';

const goodCompleter = {
  complete: async () => ({ description: 'a summary', tags: ['one', 'two'] })
};
const throwingCompleter = {
  complete: async () => {
    throw new Error('ollama down');
  }
};

describe('enrichImage', () => {
  it('returns the parsed description and tags', async () => {
    const result = await enrichImage(goodCompleter, new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ description: 'a summary', tags: ['one', 'two'] });
  });

  it('returns an empty enrichment when the model call throws', async () => {
    const result = await enrichImage(throwingCompleter, new Uint8Array([1]));
    expect(result).toEqual({ description: '', tags: [] });
  });

  it('coerces a malformed model result to an empty enrichment', async () => {
    const result = await enrichImage({ complete: async () => 'not an object' }, new Uint8Array([1]));
    expect(result).toEqual({ description: '', tags: [] });
  });
});

describe('enrichUrl', () => {
  it('fetches, extracts and summarises a page', async () => {
    const fetcher = async () => '<p>Some article body</p>';
    const result = await enrichUrl(goodCompleter, fetcher, 'https://example.com');
    expect(result).toEqual({ description: 'a summary', tags: ['one', 'two'] });
  });

  it('returns an empty enrichment when the fetch throws', async () => {
    const fetcher = async () => {
      throw new Error('offline');
    };
    const result = await enrichUrl(goodCompleter, fetcher, 'https://example.com');
    expect(result).toEqual({ description: '', tags: [] });
  });

  it('returns an empty enrichment when the page has no text', async () => {
    const result = await enrichUrl(goodCompleter, async () => '<style>x</style>', 'https://x.com');
    expect(result).toEqual({ description: '', tags: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/enrich.test.ts`
Expected: FAIL — cannot resolve `../src/main/enrich`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/enrich.ts`:

```ts
import type { Enrichment } from '../shared/types';
import { extractText } from './webpage';

/** Fetches a URL and returns the response body as text. */
export type Fetcher = (url: string) => Promise<string>;

/** A non-streaming structured completion source (satisfied by the Ollama client). */
interface Completer {
  complete(prompt: string, opts?: { images?: string[]; format?: unknown }): Promise<unknown>;
}

const EMPTY: Enrichment = { description: '', tags: [] };

/** JSON schema constraining the model to a description + tag list. */
const SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['description', 'tags']
};

/** Coerce an unknown model result into a safe Enrichment. */
function coerce(value: unknown): Enrichment {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const v = value as { description?: unknown; tags?: unknown };
  return {
    description: typeof v.description === 'string' ? v.description : '',
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : []
  };
}

/** Describe an image: returns a description + tags, or an empty Enrichment on failure. */
export async function enrichImage(ollama: Completer, bytes: Uint8Array): Promise<Enrichment> {
  try {
    const result = await ollama.complete(
      'Describe this image in one concise, factual paragraph, then give 3-6 ' +
        'short lowercase topic tags. Respond as JSON.',
      { images: [Buffer.from(bytes).toString('base64')], format: SCHEMA }
    );
    return coerce(result);
  } catch {
    return EMPTY;
  }
}

/** Summarise a web page: returns a description + tags, or an empty Enrichment on failure. */
export async function enrichUrl(
  ollama: Completer,
  fetcher: Fetcher,
  url: string
): Promise<Enrichment> {
  let text: string;
  try {
    text = extractText(await fetcher(url));
  } catch {
    return EMPTY;
  }
  if (!text) return EMPTY;
  try {
    const result = await ollama.complete(
      'Summarise the following web page in one concise paragraph, then give ' +
        `3-6 short lowercase topic tags. Respond as JSON.\n\nPage:\n${text}`,
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
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/enrich.ts test/enrich.test.ts
git commit -m "feat: add image and URL enrichment orchestration"
```

---

## Task 4: Enrichment IPC

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add the enrichment handlers to `ipc.ts`**

In `src/main/ipc.ts`, add this import after the existing imports:

```ts
import { enrichImage, enrichUrl } from './enrich';
```

Add this helper above `registerIpc` (after the imports):

```ts
/** Fetch a page's HTML, with an 8s timeout. */
async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  return res.text();
}
```

Add these handlers inside `registerIpc`, after the `ollama:status` handler:

```ts
  ipcMain.handle('enrich:image', (_e, data: Uint8Array) => enrichImage(ollama, data));

  ipcMain.handle('enrich:url', (_e, url: string) => enrichUrl(ollama, fetchPage, url));
```

- [ ] **Step 2: Expose the enrichment calls in the preload bridge**

In `src/preload/index.ts`, add `Enrichment` to the type import:

```ts
import type {
  Card,
  NewCard,
  SearchResult,
  OllamaStatus,
  AnswerResult,
  Enrichment
} from '../shared/types';
```

Add these methods to the `LocalGoldApi` interface (after `pickImages`):

```ts
  enrichImage(data: Uint8Array): Promise<Enrichment>;
  enrichUrl(url: string): Promise<Enrichment>;
```

Add these properties to the `api` object (after `pickImages`):

```ts
  enrichImage: (data) => ipcRenderer.invoke('enrich:image', data),
  enrichUrl: (url) => ipcRenderer.invoke('enrich:url', url),
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: add enrichment IPC channels"
```

---

## Task 5: Capture view — enrichment wiring

**Files:**
- Rewrite: `src/renderer/capture.ts`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Replace the entire contents of `src/renderer/capture.ts`**

```ts
import type { Enrichment, NewCard } from '../shared/types';

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
  const images: NewCard['images'] = [];
  let lastEnrichedUrl = '';

  /** Append a `## heading` description to the body and merge tags. */
  function applyEnrichment(heading: string, enr: Enrichment): void {
    if (enr.description) {
      const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
      body.value = `${prefix}## ${heading}\n${enr.description}`;
    }
    if (enr.tags.length > 0) {
      const current = tags.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      for (const tag of enr.tags) {
        if (!current.includes(tag)) current.push(tag);
      }
      tags.value = current.join(', ');
    }
  }

  /** Add an image to the pending set, show a thumbnail, and enrich it. */
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

  /** Enrich the URL if the checkbox is on and the URL is new. */
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
      url: urlValue || undefined
    });
    body.value = '';
    tags.value = '';
    url.value = '';
    images.length = 0;
    thumbs.innerHTML = '';
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
```

- [ ] **Step 2: Add the checkbox-row label style**

Append to `src/renderer/styles.css`:

```css
.row label { color: var(--fg-muted); font-size: 12px; cursor: pointer; }
#enrich-status { margin-top: 6px; }
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/capture.ts src/renderer/styles.css
git commit -m "feat: wire background image and URL enrichment into capture"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, including the new `webpage` and `enrich` suites
and the new `ollama` complete tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the running app**

Run: `npm run rebuild && npm run dev`

With Ollama running and `gemma4:e4b` pulled:
- In Capture, attach an image — within a few seconds the status shows
  "Describing image…", then a `## Image` description appears in the body and
  topic tags appear in the tags field.
- Type a URL, tick **"Summarise the linked page"** — the status shows
  "Reading the page…", then a `## Link` summary and tags appear.
- Edit or delete any of the suggested text, then Save — the card stores what
  you left in the fields.

With Ollama stopped:
- Attaching an image still works; the status shows "Enrichment unavailable.";
  capture and save are unaffected.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 7 complete — AI enrichment" --allow-empty
```

---

## Phase 7 Done

Attaching an image auto-fills a Gemma-written description and tags; ticking the
URL checkbox fetches and summarizes the page. Both land in editable fields
before save, run in the background, and degrade silently when Ollama or the
network is unavailable. The test suite passes.
