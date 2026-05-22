# LocalGold Phase 3 — Synthesized Answers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ⌘+Enter "ask mode" — Gemma 4 synthesizes a streamed, citation-grounded answer from the user's top 8 search-result cards.

**Architecture:** A new `answer.ts` module runs `hybridSearch`, takes the top 8 cards, builds a grounded prompt, and streams Gemma's answer through a `Chatter` interface. `ollama.ts` gains a streaming `chat` method. A streaming `answer:ask` IPC channel forwards tokens to the renderer, which shows an answer panel with clickable `[n]` citations that scroll to the source cards.

**Tech Stack:** Electron, TypeScript, better-sqlite3, Ollama `/api/chat` (streaming NDJSON), Gemma 4, Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: add ChatMessage, Chatter, AnswerResult
  main/
    config.ts            — MODIFY: add answerModel
    ollama.ts            — MODIFY: add streaming chat()
    answer.ts            — CREATE: prompt builder + synthesizeAnswer
    ipc.ts               — MODIFY: streaming answer:ask channel
    index.ts             — MODIFY: pass answerModel to createOllama
  preload/index.ts       — MODIFY: expose ask()
  renderer/
    citations.ts         — CREATE: parse [n] markers in answer text
    library.ts           — MODIFY: ⌘+Enter, answer panel, citation links
    styles.css           — MODIFY: answer panel + flash styles
test/
  config.test.ts         — MODIFY
  ollama.test.ts         — MODIFY
  answer.test.ts         — CREATE
  citations.test.ts      — CREATE
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev`. (Same as Phases 1–2.)

---

## Task 1: config — answerModel

**Files:**
- Modify: `src/main/config.ts`
- Test: `test/config.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/config.test.ts`:

```ts
describe('config: answerModel', () => {
  it('defaults answerModel to gemma4:e4b', () => {
    const root = tmpRoot();
    expect(loadConfig(root).answerModel).toBe('gemma4:e4b');
    rmSync(root, { recursive: true, force: true });
  });

  it('reads answerModel from config.json', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'config.json'), JSON.stringify({ answerModel: 'gemma4:31b' }));
    expect(loadConfig(root).answerModel).toBe('gemma4:31b');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/config.test.ts`
Expected: FAIL — `answerModel` is `undefined`.

- [ ] **Step 3: Add `answerModel` to config**

In `src/main/config.ts`, add `answerModel: string;` to the `Config` interface,
add `answerModel: 'gemma4:e4b'` to the `DEFAULTS` object, and add this line to
the object returned by `loadConfig` (after `embedModel`):

```ts
    answerModel:
      typeof parsed.answerModel === 'string' ? parsed.answerModel : DEFAULTS.answerModel
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts test/config.test.ts
git commit -m "feat: add answerModel to config"
```

---

## Task 2: Ollama streaming chat

**Files:**
- Modify: `src/shared/types.ts`, `src/main/ollama.ts`
- Test: `test/ollama.test.ts` (append)

- [ ] **Step 1: Add the shared chat types**

Append to `src/shared/types.ts`:

```ts
/** One message in a chat exchange. */
export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** A streaming chat model. `onToken` is called with each text chunk. */
export interface Chatter {
  chat(messages: ChatMessage[], onToken: (chunk: string) => void): Promise<void>;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/ollama.test.ts`:

```ts
describe('ollama: chat', () => {
  it('streams tokens from /api/chat in order', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/chat') {
        res.write(JSON.stringify({ message: { content: 'Hello' } }) + '\n');
        res.write(JSON.stringify({ message: { content: ' world' }, done: true }) + '\n');
        res.end();
      }
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    const chunks: string[] = [];
    await ollama.chat([{ role: 'user', content: 'hi' }], (c) => chunks.push(c));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('throws when chat returns a non-200', async () => {
    const url = await stubOllama((reqUrl, res) => {
      res.statusCode = 500;
      res.end('err');
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    await expect(
      ollama.chat([{ role: 'user', content: 'hi' }], () => undefined)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/ollama.test.ts`
Expected: FAIL — `ollama.chat` is not a function.

- [ ] **Step 4: Add `chat` to the Ollama client**

In `src/main/ollama.ts`:

Change the import line to:

```ts
import type { Chatter, ChatMessage, Embedder, OllamaStatus } from '../shared/types';
```

Change the `Ollama` interface to also extend `Chatter`:

```ts
/** A local Ollama client: health check, embeddings, and streaming chat. */
export interface Ollama extends Embedder, Chatter {
  health(): Promise<OllamaStatus>;
}
```

Change the `createOllama` signature to take a chat model (defaulted, so
existing callers are unaffected):

```ts
export function createOllama(
  ollamaUrl: string,
  model: string,
  chatModel = 'gemma4:e4b'
): Ollama {
```

Add this `chat` function inside `createOllama`, after `embed`:

```ts
  async function chat(
    messages: ChatMessage[],
    onToken: (chunk: string) => void
  ): Promise<void> {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: chatModel, messages, stream: true }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`Ollama chat failed: HTTP ${res.status}`);
    if (!res.body) throw new Error('Ollama chat: no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as { message?: { content?: string } };
        if (obj.message?.content) onToken(obj.message.content);
      }
    }
  }
```

Change the return statement to include `chat`:

```ts
  return { health, embed, chat };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/ollama.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/ollama.ts test/ollama.test.ts
git commit -m "feat: add streaming chat to Ollama client"
```

---

## Task 3: answer prompt builder

**Files:**
- Create: `src/main/answer.ts`
- Test: `test/answer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/answer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMessages } from '../src/main/answer';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-22T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('buildMessages', () => {
  it('numbers cards [1..n] and includes the question', () => {
    const msgs = buildMessages([card('a', 'first note'), card('b', 'second note')], 'what?');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/\[n\]/);
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('[1] first note');
    expect(msgs[1].content).toContain('[2] second note');
    expect(msgs[1].content).toContain('what?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/answer.test.ts`
Expected: FAIL — cannot resolve `../src/main/answer`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/answer.ts`:

```ts
import type { Card, ChatMessage } from '../shared/types';

const SYSTEM_PROMPT =
  'You answer the user\'s question using only the numbered cards provided. ' +
  'Cite the cards that support each claim inline as [n], matching the card numbers. ' +
  'Be concise. If the cards do not cover the question, say so plainly.';

/** Build the chat messages for a grounded answer over numbered cards. */
export function buildMessages(cards: Card[], query: string): ChatMessage[] {
  const numbered = cards.map((c, i) => `[${i + 1}] ${c.body}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Cards:\n\n${numbered}\n\nQuestion: ${query}` }
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/answer.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/main/answer.ts test/answer.test.ts
git commit -m "feat: add answer prompt builder"
```

---

## Task 4: synthesizeAnswer orchestration

**Files:**
- Modify: `src/shared/types.ts`, `src/main/answer.ts`
- Test: `test/answer.test.ts` (append)

- [ ] **Step 1: Add the `AnswerResult` shared type**

Append to `src/shared/types.ts`:

```ts
/** A synthesized answer and the source cards it was grounded in. */
export interface AnswerResult {
  /** The full answer text, with inline [n] citation markers. */
  answer: string;
  /** The cards passed to the model, in [1..n] order. */
  sources: Card[];
}
```

- [ ] **Step 2: Write the failing tests**

Append to `test/answer.test.ts`:

```ts
import { synthesizeAnswer, ANSWER_CARD_COUNT } from '../src/main/answer';
import { openDb, initSchema, upsertCard } from '../src/main/index-db';
import type { Chatter, Embedder } from '../src/shared/types';

const embedder: Embedder = { embed: async () => Float32Array.from([1, 0, 0]) };

/** Chatter that emits a fixed list of tokens. */
function fakeChatter(tokens: string[]): Chatter {
  return {
    chat: async (_messages, onToken) => {
      for (const t of tokens) onToken(t);
    }
  };
}

describe('synthesizeAnswer', () => {
  it('streams tokens and returns the assembled answer with sources', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('c1', 'a shared topic note'), '/p/c1.md', 'h');
    const chatter = fakeChatter(['Part one. ', 'Part two [1].']);
    const got: string[] = [];
    const result = await synthesizeAnswer(db, embedder, chatter, 'shared', (c) => got.push(c));
    expect(got).toEqual(['Part one. ', 'Part two [1].']);
    expect(result.answer).toBe('Part one. Part two [1].');
    expect(result.sources.map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  it('uses at most the top ANSWER_CARD_COUNT cards', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    for (let i = 0; i < ANSWER_CARD_COUNT + 4; i += 1) {
      upsertCard(db, card(`c${i}`, `shared topic note ${i}`), `/p/c${i}.md`, 'h');
    }
    const result = await synthesizeAnswer(db, embedder, fakeChatter(['x']), 'shared', () => undefined);
    expect(result.sources).toHaveLength(ANSWER_CARD_COUNT);
    db.close();
  });

  it('returns an empty answer when nothing matches', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    const result = await synthesizeAnswer(db, embedder, fakeChatter(['x']), 'absent', () => undefined);
    expect(result).toEqual({ answer: '', sources: [] });
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/answer.test.ts`
Expected: FAIL — `synthesizeAnswer` / `ANSWER_CARD_COUNT` not exported.

- [ ] **Step 4: Write minimal implementation**

Append to `src/main/answer.ts`:

```ts
import type { DB } from './index-db';
import { hybridSearch } from './search';
import type { AnswerResult, Chatter, Embedder } from '../shared/types';

/** How many top search-result cards are fed to the model. */
export const ANSWER_CARD_COUNT = 8;

/**
 * Retrieve the top cards for `query`, prompt the chat model to answer from
 * them, and stream the answer back through `onToken`. Returns the full answer
 * and the source cards. If nothing matches, returns an empty answer.
 */
export async function synthesizeAnswer(
  db: DB,
  embedder: Embedder,
  chatter: Chatter,
  query: string,
  onToken: (chunk: string) => void
): Promise<AnswerResult> {
  const hits = await hybridSearch(db, embedder, query);
  const sources = hits.slice(0, ANSWER_CARD_COUNT).map((h) => h.card);
  if (sources.length === 0) return { answer: '', sources: [] };

  let answer = '';
  await chatter.chat(buildMessages(sources, query), (chunk) => {
    answer += chunk;
    onToken(chunk);
  });
  return { answer, sources };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/answer.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/answer.ts test/answer.test.ts
git commit -m "feat: add synthesizeAnswer orchestration"
```

---

## Task 5: citation parsing

**Files:**
- Create: `src/renderer/citations.ts`
- Test: `test/citations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/citations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCitations } from '../src/renderer/citations';

describe('parseCitations', () => {
  it('splits text around [n] markers', () => {
    expect(parseCitations('before [2] after')).toEqual([
      { text: 'before ', citation: null },
      { text: '[2]', citation: 2 },
      { text: ' after', citation: null }
    ]);
  });

  it('returns a single plain segment when there are no markers', () => {
    expect(parseCitations('just text')).toEqual([{ text: 'just text', citation: null }]);
  });

  it('handles consecutive and multi-digit markers', () => {
    expect(parseCitations('[1][12]')).toEqual([
      { text: '[1]', citation: 1 },
      { text: '[12]', citation: 12 }
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCitations('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/citations.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/citations`.

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/citations.ts`:

```ts
/** A run of answer text: plain prose, or a [n] citation marker. */
export interface Segment {
  text: string;
  /** The cited card number, or null for plain text. */
  citation: number | null;
}

/** Split answer text into plain segments and [n] citation markers. */
export function parseCitations(answer: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) {
      segments.push({ text: answer.slice(last, m.index), citation: null });
    }
    segments.push({ text: m[0], citation: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    segments.push({ text: answer.slice(last), citation: null });
  }
  return segments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/citations.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/citations.ts test/citations.test.ts
git commit -m "feat: add citation marker parsing"
```

---

## Task 6: streaming IPC channel

**Files:**
- Modify: `src/main/ipc.ts`, `src/main/index.ts`

- [ ] **Step 1: Add the `answer:ask` channel to `ipc.ts`**

In `src/main/ipc.ts`:

Add this import after the existing imports:

```ts
import { synthesizeAnswer } from './answer';
```

Add this block inside `registerIpc`, after the `ollama:status` handler:

```ts
  // Streaming: tokens flow back as answer:token, ending with done or error.
  ipcMain.on('answer:ask', async (e, query: string) => {
    try {
      const result = await synthesizeAnswer(db, ollama, ollama, query, (chunk) => {
        e.sender.send('answer:token', chunk);
      });
      e.sender.send('answer:done', result);
    } catch (err) {
      e.sender.send('answer:error', err instanceof Error ? err.message : String(err));
    }
  });
```

- [ ] **Step 2: Pass the answer model to `createOllama` in `index.ts`**

In `src/main/index.ts`, change the `createOllama` call to pass the chat model:

```ts
  const ollama = createOllama(config.ollamaUrl, config.embedModel, config.answerModel);
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: add streaming answer:ask IPC channel"
```

---

## Task 7: preload — ask()

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Update the preload bridge**

In `src/preload/index.ts`:

Change the import line to:

```ts
import type { Card, NewCard, SearchResult, OllamaStatus, AnswerResult } from '../shared/types';
```

Add this method to the `LocalGoldApi` interface (after `ollamaStatus`):

```ts
  ask(query: string, onToken: (chunk: string) => void): Promise<AnswerResult>;
```

Add this property to the `api` object (after `ollamaStatus`):

```ts
  ask: (query, onToken) =>
    new Promise<AnswerResult>((resolve, reject) => {
      const onTok = (_e: unknown, chunk: string): void => onToken(chunk);
      const onDone = (_e: unknown, result: AnswerResult): void => {
        cleanup();
        resolve(result);
      };
      const onErr = (_e: unknown, message: string): void => {
        cleanup();
        reject(new Error(message));
      };
      function cleanup(): void {
        ipcRenderer.off('answer:token', onTok);
        ipcRenderer.off('answer:done', onDone);
        ipcRenderer.off('answer:error', onErr);
      }
      ipcRenderer.on('answer:token', onTok);
      ipcRenderer.once('answer:done', onDone);
      ipcRenderer.once('answer:error', onErr);
      ipcRenderer.send('answer:ask', query);
    })
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose streaming ask() in preload"
```

---

## Task 8: renderer — ask mode and answer panel

**Files:**
- Modify: `src/renderer/library.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Rewrite `src/renderer/library.ts`**

Replace the entire contents of `src/renderer/library.ts`:

```ts
import type { AnswerResult, Card } from '../shared/types';
import { parseCitations } from './citations';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function cardHtml(card: Card, snippet?: string): string {
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const text = snippet
    ? escapeHtml(snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')
    : escapeHtml(card.body.slice(0, 240));
  const attach = card.attachments.length
    ? `<div class="meta">${card.attachments.length} image(s) attached</div>`
    : '';
  return `<div class="card" data-card-id="${escapeHtml(card.id)}">
    <div class="meta">${escapeHtml(card.created)}</div>
    <div>${text}</div>
    <div>${tags}</div>${attach}
  </div>`;
}

/** Render a finished answer: inline [n] links plus a Sources list. */
function answerHtml(result: AnswerResult): string {
  const body = parseCitations(result.answer)
    .map((seg) => {
      if (
        seg.citation !== null &&
        seg.citation >= 1 &&
        seg.citation <= result.sources.length
      ) {
        const id = result.sources[seg.citation - 1].id;
        return `<a class="cite" data-card-id="${escapeHtml(id)}">${escapeHtml(seg.text)}</a>`;
      }
      return escapeHtml(seg.text);
    })
    .join('');
  const sources = result.sources
    .map(
      (c, i) =>
        `<li><a class="cite" data-card-id="${escapeHtml(c.id)}">[${i + 1}]</a> ` +
        `${escapeHtml(c.body.slice(0, 80))}</li>`
    )
    .join('');
  return `<h3>Answer</h3><div class="answer-text">${body}</div>
    <h4>Sources</h4><ul class="sources">${sources}</ul>`;
}

/** Map a chat error message to a short fix hint. */
function errorHint(message: string): string {
  return /HTTP [45]/.test(message) ? 'run: ollama pull gemma4:e4b' : 'start Ollama';
}

/** Render the library / search view into `host`. */
export function renderLibrary(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Library</h2>
    <div id="ollama-status" class="hint"></div>
    <input id="q" type="text" placeholder="Search cards…  (⌘+Enter to ask)" />
    <div id="answer"></div>
    <div id="results"></div>
  `;
  const q = host.querySelector<HTMLInputElement>('#q')!;
  const results = host.querySelector<HTMLDivElement>('#results')!;
  const statusEl = host.querySelector<HTMLDivElement>('#ollama-status')!;
  const answerEl = host.querySelector<HTMLDivElement>('#answer')!;

  async function showStatus(): Promise<void> {
    const status = await window.localgold.ollamaStatus();
    if (status.reachable && status.hasEmbedModel) {
      statusEl.textContent = 'Semantic search on';
    } else if (status.reachable) {
      statusEl.textContent = 'Semantic search off — run: ollama pull embeddinggemma';
    } else {
      statusEl.textContent = 'Semantic search offline — start Ollama';
    }
  }

  async function showAll(): Promise<void> {
    const cards = await window.localgold.listCards();
    results.innerHTML = cards.length
      ? cards.map((c) => cardHtml(c)).join('')
      : '<p class="hint">No cards yet.</p>';
  }

  q.addEventListener('input', async () => {
    const term = q.value.trim();
    if (!term) {
      await showAll();
      return;
    }
    const hits = await window.localgold.search(term);
    results.innerHTML = hits.length
      ? hits.map((h) => cardHtml(h.card, h.snippet)).join('')
      : '<p class="hint">No matches.</p>';
  });

  q.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const term = q.value.trim();
    if (!term) return;
    answerEl.innerHTML = '<h3>Answer</h3><div class="answer-text generating"></div>';
    const textEl = answerEl.querySelector<HTMLDivElement>('.answer-text')!;
    let raw = '';
    try {
      const result = await window.localgold.ask(term, (chunk) => {
        raw += chunk;
        textEl.textContent = raw;
      });
      answerEl.innerHTML = result.sources.length
        ? answerHtml(result)
        : '<h3>Answer</h3><p class="hint">No cards to answer from.</p>';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      textEl.classList.remove('generating');
      textEl.innerHTML =
        escapeHtml(raw) +
        `<p class="hint">Answer unavailable — ${escapeHtml(errorHint(message))}</p>`;
    }
  });

  answerEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('cite')) return;
    const id = target.getAttribute('data-card-id');
    if (!id) return;
    const cardEl = results.querySelector<HTMLElement>(`.card[data-card-id="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cardEl.classList.remove('flash');
    void cardEl.offsetWidth;
    cardEl.classList.add('flash');
  });

  void showStatus();
  void showAll();
}
```

- [ ] **Step 2: Add answer-panel styles**

Append to `src/renderer/styles.css`:

```css
#answer:not(:empty) {
  border: 1px solid #e2e2e2;
  border-radius: 8px;
  padding: 12px;
  margin: 10px 0;
  background: #fffdf5;
}
#answer h3 { margin: 0 0 6px; }
#answer h4 { margin: 12px 0 4px; }
.answer-text { white-space: pre-wrap; }
.answer-text.generating::after { content: ' ▍'; }
.cite { color: #b8860b; cursor: pointer; text-decoration: none; }
.sources { padding-left: 0; list-style: none; margin: 0; }
.sources li { margin: 2px 0; }
.card.flash { animation: flash 1s ease-out; }
@keyframes flash {
  from { background: #f7e08c; }
  to { background: transparent; }
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/library.ts src/renderer/styles.css
git commit -m "feat: add ask mode, answer panel and citation links"
```

---

## Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test across `store`, `index-db`, `config`, `rank`,
`search`, `ollama`, `embeddings`, `answer`, `citations`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify ask mode in the running app**

Run: `npm run rebuild && npm run dev`

With Ollama running and `gemma4:e4b` pulled:
- Capture a few cards on a shared theme.
- Type a question into the search box and press **⌘+Enter**.
- An answer panel streams in above the card list, with inline `[n]` markers and
  a Sources list. Clicking a marker or source scrolls to and flashes that card.

With Ollama stopped:
- ⌘+Enter shows "Answer unavailable — start Ollama"; search and capture still work.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 3 complete — synthesized answers" --allow-empty
```

---

## Phase 3 Done

⌘+Enter on a query streams a Gemma 4 answer grounded in the user's top 8 cards,
with clickable inline citations. Search, semantic search, and capture are
unaffected and the answer degrades gracefully when Gemma is unavailable.
LocalGold is now a local-first capture, search, and question-answering tool.
