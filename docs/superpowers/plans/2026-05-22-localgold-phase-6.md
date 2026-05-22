# LocalGold Phase 6 — Capture: Image Picker + URL Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Choose images…" file-picker button and an optional URL field to the Capture view, with the URL stored as a dedicated card frontmatter field.

**Architecture:** `Card`/`NewCard` gain an optional `url`. `store.ts` reads/writes it in frontmatter; `index-db.ts` gains a `url` column. A new `dialog:pick-images` IPC opens the native file dialog and returns image bytes in the same shape paste produces. The Capture view gets the button and input.

**Tech Stack:** Electron (`dialog`), TypeScript, better-sqlite3, gray-matter, Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: url? on Card and NewCard
  main/store.ts          — MODIFY: serialize/parse/write url
  main/index-db.ts       — MODIFY: url column + accessors
  main/ipc.ts            — MODIFY: dialog:pick-images handler
  preload/index.ts       — MODIFY: expose pickImages()
  renderer/capture.ts    — REWRITE: Choose-images button + URL input
  renderer/styles.css    — MODIFY: .secondary button, .row
test/
  store.test.ts          — MODIFY: url round-trip tests
  index-db.test.ts       — MODIFY: url accessor tests
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as Phases 1–4).

---

## Task 1: Card `url` field — types and store

**Files:**
- Modify: `src/shared/types.ts`, `src/main/store.ts`
- Test: `test/store.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.ts`:

```ts
describe('store: url field', () => {
  it('round-trips a card that has a url', () => {
    const card = {
      id: '2026-05-22-abcd1234',
      created: '2026-05-22T09:00:00.000Z',
      body: 'a thought',
      tags: ['idea'],
      attachments: [],
      url: 'https://example.com/article'
    };
    expect(parseCard(serializeCard(card), 'fallback')).toEqual(card);
  });

  it('omits the url line when the card has none', () => {
    const card = {
      id: 'x',
      created: '2026-01-01T00:00:00.000Z',
      body: 'a thought',
      tags: [],
      attachments: []
    };
    const text = serializeCard(card);
    expect(text).not.toContain('url:');
    expect(parseCard(text, 'x')).toEqual(card);
  });

  it('writeCard persists a provided url', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    const card = await writeCard(root, {
      body: 'b',
      tags: [],
      images: [],
      url: 'https://example.com/a'
    });
    expect(card.url).toBe('https://example.com/a');
    expect((await readCard(root, card.id))?.url).toBe('https://example.com/a');
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/store.test.ts`
Expected: FAIL — `url` is not preserved.

- [ ] **Step 3: Add `url` to the shared types**

In `src/shared/types.ts`, add to the `Card` interface (after `attachments`):

```ts
  /** Optional source URL for the card. */
  url?: string;
```

And add to the `NewCard` interface (after `images`):

```ts
  url?: string;
```

- [ ] **Step 4: Handle `url` in `store.ts`**

In `src/main/store.ts`, in `serializeCard`, add the `url` line after the
`tags` line. Replace:

```ts
  if (card.attachments.length > 0) {
    lines.push(`attachments: [${card.attachments.join(', ')}]`);
  }
```

with:

```ts
  if (card.url) {
    lines.push(`url: ${card.url}`);
  }
  if (card.attachments.length > 0) {
    lines.push(`attachments: [${card.attachments.join(', ')}]`);
  }
```

In `parseCard`, replace the `return` statement:

```ts
  return {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    created,
    body: content.trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : []
  };
```

with:

```ts
  const card: Card = {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    created,
    body: content.trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : []
  };
  if (typeof data.url === 'string' && data.url.trim()) {
    card.url = data.url.trim();
  }
  return card;
```

In `writeCard`, replace the `card` construction:

```ts
  const card: Card = {
    id: stem,
    created: created.toISOString(),
    body: input.body,
    tags: input.tags,
    attachments
  };
```

with:

```ts
  const card: Card = {
    id: stem,
    created: created.toISOString(),
    body: input.body,
    tags: input.tags,
    attachments
  };
  if (input.url && input.url.trim()) {
    card.url = input.url.trim();
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS — all `store` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/store.ts test/store.test.ts
git commit -m "feat: add optional url field to cards"
```

---

## Task 2: index-db — `url` column

**Files:**
- Modify: `src/main/index-db.ts`
- Test: `test/index-db.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/index-db.test.ts`:

```ts
describe('index-db: url', () => {
  it('upsert then getCard preserves a url', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard({ url: 'https://example.com' }), '/p/c1.md', 'h');
    expect(getCard(db, 'c1')?.url).toBe('https://example.com');
    db.close();
  });

  it('a card with no url reads back without one', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'h');
    expect(getCard(db, 'c1')?.url).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index-db.test.ts`
Expected: FAIL — `url` is not stored/returned.

- [ ] **Step 3: Add the `url` column**

In `src/main/index-db.ts`, in `initSchema`, add a `url` column to the `cards`
table. Replace:

```ts
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      created      TEXT NOT NULL,
      body         TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      attachments  TEXT NOT NULL DEFAULT '[]',
      file_path    TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
```

with:

```ts
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      created      TEXT NOT NULL,
      body         TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      attachments  TEXT NOT NULL DEFAULT '[]',
      url          TEXT NOT NULL DEFAULT '',
      file_path    TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
```

Then, at the end of `initSchema` (after the `db.exec(...)` call), add a
guarded migration so an `index.db` created before this change also gains the
column:

```ts
  // Upgrade an index.db created before the url column existed.
  try {
    db.exec("ALTER TABLE cards ADD COLUMN url TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — nothing to do.
  }
```

- [ ] **Step 4: Carry `url` through the accessors**

In `src/main/index-db.ts`, add `url` to the `CardRow` interface:

```ts
interface CardRow {
  id: string;
  created: string;
  body: string;
  tags: string;
  attachments: string;
  url: string;
}
```

Replace `rowToCard`:

```ts
function rowToCard(row: CardRow): Card {
  return {
    id: row.id,
    created: row.created,
    body: row.body,
    tags: JSON.parse(row.tags),
    attachments: JSON.parse(row.attachments)
  };
}
```

with:

```ts
function rowToCard(row: CardRow): Card {
  const card: Card = {
    id: row.id,
    created: row.created,
    body: row.body,
    tags: JSON.parse(row.tags),
    attachments: JSON.parse(row.attachments)
  };
  if (row.url) card.url = row.url;
  return card;
}
```

In `upsertCard`, replace the prepared statement and its bound object:

```ts
  db.prepare(
    `INSERT INTO cards (id, created, body, tags, attachments, file_path, content_hash)
     VALUES (@id, @created, @body, @tags, @attachments, @file_path, @content_hash)
     ON CONFLICT(id) DO UPDATE SET
       created=@created, body=@body, tags=@tags, attachments=@attachments,
       file_path=@file_path, content_hash=@content_hash`
  ).run({
    id: card.id,
    created: card.created,
    body: card.body,
    tags: JSON.stringify(card.tags),
    attachments: JSON.stringify(card.attachments),
    file_path: filePath,
    content_hash: hash
  });
```

with:

```ts
  db.prepare(
    `INSERT INTO cards (id, created, body, tags, attachments, url, file_path, content_hash)
     VALUES (@id, @created, @body, @tags, @attachments, @url, @file_path, @content_hash)
     ON CONFLICT(id) DO UPDATE SET
       created=@created, body=@body, tags=@tags, attachments=@attachments,
       url=@url, file_path=@file_path, content_hash=@content_hash`
  ).run({
    id: card.id,
    created: card.created,
    body: card.body,
    tags: JSON.stringify(card.tags),
    attachments: JSON.stringify(card.attachments),
    url: card.url ?? '',
    file_path: filePath,
    content_hash: hash
  });
```

In `getCard`, replace the SELECT:

```ts
    .prepare('SELECT id, created, body, tags, attachments FROM cards WHERE id = ?')
```

with:

```ts
    .prepare('SELECT id, created, body, tags, attachments, url FROM cards WHERE id = ?')
```

In `listCards`, replace the SELECT:

```ts
      'SELECT id, created, body, tags, attachments FROM cards ORDER BY created DESC LIMIT ? OFFSET ?'
```

with:

```ts
      'SELECT id, created, body, tags, attachments, url FROM cards ORDER BY created DESC LIMIT ? OFFSET ?'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/index-db.test.ts`
Expected: PASS — all `index-db` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main/index-db.ts test/index-db.test.ts
git commit -m "feat: store card url in the index"
```

---

## Task 3: dialog:pick-images IPC

**Files:**
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add the `dialog:pick-images` handler**

In `src/main/ipc.ts`, change the Electron import:

```ts
import { ipcMain } from 'electron';
```

to:

```ts
import { ipcMain, dialog } from 'electron';
```

Change the `path` import to also bring in `basename`:

```ts
import { join } from 'path';
```

to:

```ts
import { join, basename } from 'path';
```

Add this handler inside `registerIpc`, after the `card:create` handler:

```ts
  ipcMain.handle('dialog:pick-images', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });
    if (result.canceled) return [];
    const images: { name: string; data: Uint8Array }[] = [];
    for (const filePath of result.filePaths) {
      try {
        const buf = await readFile(filePath);
        images.push({ name: basename(filePath), data: new Uint8Array(buf) });
      } catch {
        // Skip a file that cannot be read; the rest still return.
      }
    }
    return images;
  });
```

(`readFile` from `fs/promises` is already imported in `ipc.ts`.)

- [ ] **Step 2: Expose `pickImages` in the preload bridge**

In `src/preload/index.ts`, add this method to the `LocalGoldApi` interface
(after `ollamaStatus`):

```ts
  pickImages(): Promise<NewCard['images']>;
```

And add this property to the `api` object (after `ollamaStatus`):

```ts
  pickImages: () => ipcRenderer.invoke('dialog:pick-images'),
```

(`NewCard` is already imported in `src/preload/index.ts`.)

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: add dialog:pick-images IPC"
```

---

## Task 4: Capture view — picker button and URL field

**Files:**
- Rewrite: `src/renderer/capture.ts`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Replace the entire contents of `src/renderer/capture.ts`**

```ts
import type { NewCard } from '../shared/types';

/** Render the capture view into `host`. */
export function renderCapture(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Capture</h2>
    <textarea id="body" placeholder="Write an insight…"></textarea>
    <input id="tags" type="text" placeholder="tags, comma, separated" />
    <input id="url" type="text" placeholder="https://…  (optional)" />
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <button class="secondary" id="pick">Choose images…</button>
      <span class="hint">or paste an image</span>
    </div>
    <button class="primary" id="save">Save card</button>
    <span id="status" class="hint"></span>
  `;

  const body = host.querySelector<HTMLTextAreaElement>('#body')!;
  const tags = host.querySelector<HTMLInputElement>('#tags')!;
  const url = host.querySelector<HTMLInputElement>('#url')!;
  const thumbs = host.querySelector<HTMLDivElement>('#thumbs')!;
  const status = host.querySelector<HTMLSpanElement>('#status')!;
  const images: NewCard['images'] = [];

  /** Add an image to the pending set and show a thumbnail. */
  function addImage(name: string, data: Uint8Array): void {
    images.push({ name, data });
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([data]));
    thumbs.appendChild(img);
  }

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
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
```

- [ ] **Step 2: Add the `.secondary` and `.row` styles**

Append to `src/renderer/styles.css`:

```css
.row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.secondary {
  padding: 7px 14px;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: inherit;
  cursor: pointer;
}
.secondary:hover { color: var(--fg); border-color: var(--fg-muted); }
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/capture.ts src/renderer/styles.css
git commit -m "feat: add image picker and URL field to capture view"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, including the new `store` url tests and
`index-db` url tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the running app**

Run: `npm run rebuild && npm run dev`

In the Capture view:
- Click **"Choose images…"** — the native file dialog opens, filtered to
  images; pick one or more and they appear as thumbnails. Pasting an image
  still works too.
- Type some text, a tag, and a URL into the URL field; click **Save card**.
- Confirm the new card's `.md` file in `~/Documents/LocalGold/cards/` has a
  `url:` line in its frontmatter, and that a card saved without a URL has no
  `url:` line.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 6 complete — image picker and URL field" --allow-empty
```

---

## Phase 6 Done

The Capture view can attach images via the native file picker (alongside
paste) and store an optional source URL as a dedicated card frontmatter field.
Existing cards without a URL remain fully valid. The test suite passes.
