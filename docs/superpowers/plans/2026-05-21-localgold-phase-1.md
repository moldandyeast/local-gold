# LocalGold Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Electron app that captures insight cards (text + tags + pasted images) as Markdown files on disk, indexes them in a rebuildable SQLite database, and provides keyword search.

**Architecture:** Electron + TypeScript. The main process owns all storage: `store` reads/writes Markdown card files, `index-db` maintains a rebuildable SQLite cache with FTS5, `search` runs keyword queries, `ipc` bridges to a vanilla-TS renderer. The `cards/` folder is the source of truth; `index.db` is a disposable cache rebuilt on startup.

**Tech Stack:** Electron, electron-vite, TypeScript, better-sqlite3 (SQLite + FTS5), gray-matter (frontmatter parsing), Vitest (tests).

---

## File Structure

```
LocalGold/
  package.json
  tsconfig.json
  electron.vite.config.ts
  vitest.config.ts
  src/
    shared/types.ts        — shared TS types (Card, NewCard, SearchResult)
    main/
      index.ts             — app entry: dirs, db, rebuild, ipc, window
      paths.ts             — resolve LocalGold dir + subpaths
      store.ts             — card Markdown read/write/parse/serialize, images
      index-db.ts          — SQLite schema, upserts, FTS queries, rebuild
      search.ts            — keyword search orchestration
      ipc.ts               — IPC handler registration
    preload/index.ts       — contextBridge typed API
    renderer/
      index.html
      main.ts              — renderer entry, view routing
      capture.ts           — capture view
      library.ts           — library / search view
      styles.css
  test/
    store.test.ts
    index-db.test.ts
    search.test.ts
```

Each main-process module has one responsibility and a narrow interface. `store` knows the on-disk format and nothing about SQLite. `index-db` owns `index.db` and nothing about Electron. `search` composes `index-db`. `ipc` is the only main module the renderer reaches.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`, `src/renderer/index.html`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "localgold",
  "version": "0.1.0",
  "description": "Local-first insight capture and search",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "rebuild": "electron-rebuild -f -w better-sqlite3"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.7.1",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.13.0",
    "electron": "^34.0.0",
    "electron-vite": "^3.0.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {}
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] }
});
```

- [ ] **Step 5: Create placeholder `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>LocalGold</title></head>
  <body>
    <div id="app">LocalGold</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create placeholder `src/renderer/main.ts`**

```ts
document.getElementById('app')!.textContent = 'LocalGold — Phase 1';
```

- [ ] **Step 7: Create placeholder `src/preload/index.ts`**

```ts
// IPC bridge — implemented in Task 11.
```

- [ ] **Step 8: Create placeholder `src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';

function createWindow(): void {
  const win = new BrowserWindow({ width: 900, height: 700, show: false });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 9: Install dependencies and rebuild the native module for Electron**

Run: `npm install && npm run rebuild`
Expected: install completes; `electron-rebuild` reports `better-sqlite3` rebuilt.

Note on ABI: `npm install` builds `better-sqlite3` for system Node (used by `npm test`). `npm run rebuild` rebuilds it for Electron (used by `npm run dev`). If you run the app and then return to tests, run `npm rebuild better-sqlite3` to switch back to the Node build.

- [ ] **Step 10: Verify the app launches**

Run: `npm run dev`
Expected: a window opens showing "LocalGold — Phase 1". Close it.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Electron + electron-vite project"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: Create the shared types**

```ts
/** A stored insight card. */
export interface Card {
  /** Filename stem, e.g. "20260521-093000-first-thoughts". */
  id: string;
  /** ISO 8601 creation timestamp. */
  created: string;
  /** Freeform Markdown body. */
  body: string;
  /** Manual tags. */
  tags: string[];
  /** Attachment paths relative to the LocalGold root, e.g. "attachments/x-1.png". */
  attachments: string[];
}

/** A card submitted from the renderer, before it is written to disk. */
export interface NewCard {
  body: string;
  tags: string[];
  images: { name: string; data: Uint8Array }[];
}

/** A search hit: the card, a relevance score, and a highlighted snippet. */
export interface SearchResult {
  card: Card;
  score: number;
  snippet: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared Card/NewCard/SearchResult types"
```

---

## Task 3: Paths module

**Files:**
- Create: `src/main/paths.ts`
- Test: `test/store.test.ts` (shared test file; paths tested first)

- [ ] **Step 1: Write the failing test**

Create `test/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { rootDir, cardsDir, attachmentsDir, dbPath } from '../src/main/paths';

describe('paths', () => {
  it('uses LOCALGOLD_DIR when set', () => {
    process.env.LOCALGOLD_DIR = '/tmp/lg-test';
    expect(rootDir()).toBe('/tmp/lg-test');
    delete process.env.LOCALGOLD_DIR;
  });

  it('derives subpaths from a root', () => {
    expect(cardsDir('/r')).toBe(join('/r', 'cards'));
    expect(attachmentsDir('/r')).toBe(join('/r', 'attachments'));
    expect(dbPath('/r')).toBe(join('/r', 'index.db'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — cannot resolve `../src/main/paths`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/paths.ts`:

```ts
import { homedir } from 'os';
import { join } from 'path';

/** The LocalGold root directory. Overridable via LOCALGOLD_DIR (used in tests). */
export function rootDir(): string {
  return process.env.LOCALGOLD_DIR ?? join(homedir(), 'Documents', 'LocalGold');
}

export function cardsDir(root: string): string {
  return join(root, 'cards');
}

export function attachmentsDir(root: string): string {
  return join(root, 'attachments');
}

export function dbPath(root: string): string {
  return join(root, 'index.db');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/paths.ts test/store.test.ts
git commit -m "feat: add paths module"
```

---

## Task 4: Store — parse, serialize, slug

**Files:**
- Create: `src/main/store.ts`
- Test: `test/store.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.ts`:

```ts
import { parseCard, serializeCard, slugify, hashContent } from '../src/main/store';

describe('store: serialize/parse', () => {
  it('slugifies the first words of a body', () => {
    expect(slugify('First thoughts on X!')).toBe('first-thoughts-on-x');
    expect(slugify('   ')).toBe('card');
  });

  it('round-trips a card through serialize then parse', () => {
    const card = {
      id: '20260521-093000-hello',
      created: '2026-05-21T09:30:00.000Z',
      body: 'Hello world.\nSecond line.',
      tags: ['idea', 'research'],
      attachments: ['attachments/20260521-093000-hello-1.png']
    };
    const parsed = parseCard(serializeCard(card), 'fallback');
    expect(parsed).toEqual(card);
  });

  it('parses a card with no tags or attachments', () => {
    const raw = '---\nid: x\ncreated: 2026-01-01T00:00:00.000Z\ntags: []\n---\n\nbody\n';
    const parsed = parseCard(raw, 'x');
    expect(parsed.tags).toEqual([]);
    expect(parsed.attachments).toEqual([]);
    expect(parsed.body).toBe('body');
  });

  it('falls back to the given id when frontmatter omits it', () => {
    const raw = '---\ncreated: 2026-01-01T00:00:00.000Z\ntags: []\n---\n\nbody\n';
    expect(parseCard(raw, 'fallback-id').id).toBe('fallback-id');
  });

  it('hashContent is stable and content-sensitive', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — cannot resolve `../src/main/store`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/store.ts`:

```ts
import { createHash } from 'crypto';
import matter from 'gray-matter';
import type { Card } from '../shared/types';

/** Build a URL-safe slug from the first six words of a body. */
export function slugify(body: string): string {
  const slug = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
    .slice(0, 40);
  return slug || 'card';
}

/** sha256 hex digest of a string. */
export function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Serialize a card to Markdown with YAML frontmatter. */
export function serializeCard(card: Card): string {
  const lines = [
    '---',
    `id: ${card.id}`,
    `created: ${card.created}`,
    `tags: [${card.tags.join(', ')}]`
  ];
  if (card.attachments.length > 0) {
    lines.push(`attachments: [${card.attachments.join(', ')}]`);
  }
  lines.push('---', '', card.body, '');
  return lines.join('\n');
}

/** Parse a Markdown card file. `fallbackId` is used if frontmatter omits `id`. */
export function parseCard(raw: string, fallbackId: string): Card {
  const { data, content } = matter(raw);
  const created =
    typeof data.created === 'string'
      ? data.created
      : data.created instanceof Date
        ? data.created.toISOString()
        : new Date(0).toISOString();
  return {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    created,
    body: content.trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : []
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS — all `store: serialize/parse` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts test/store.test.ts
git commit -m "feat: add card serialize/parse/slug helpers"
```

---

## Task 5: Store — write, list, read cards

**Files:**
- Modify: `src/main/store.ts`
- Test: `test/store.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.ts`:

```ts
import { writeCard, listCards, listCardFiles, readCard } from '../src/main/store';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pjoin } from 'path';

describe('store: write/list/read', () => {
  function tmpRoot(): string {
    return mkdtempSync(pjoin(tmpdir(), 'lg-'));
  }

  it('writes a card file and an image attachment', async () => {
    const root = tmpRoot();
    const card = await writeCard(root, {
      body: 'A captured thought',
      tags: ['idea'],
      images: [{ name: 'pic.png', data: new Uint8Array([1, 2, 3]) }]
    });
    expect(card.id).toMatch(/^\d{8}-\d{6}-a-captured-thought$/);
    expect(card.attachments).toHaveLength(1);
    const read = await readCard(root, card.id);
    expect(read?.body).toBe('A captured thought');
    rmSync(root, { recursive: true, force: true });
  });

  it('lists cards newest first', async () => {
    const root = tmpRoot();
    const first = await writeCard(root, { body: 'older', tags: [], images: [] });
    await new Promise((r) => setTimeout(r, 1100));
    const second = await writeCard(root, { body: 'newer', tags: [], images: [] });
    const all = await listCards(root);
    expect(all.map((c) => c.id)).toEqual([second.id, first.id]);
    rmSync(root, { recursive: true, force: true });
  });

  it('listCardFiles returns raw contents and a hash', async () => {
    const root = tmpRoot();
    const card = await writeCard(root, { body: 'hashme', tags: [], images: [] });
    const files = await listCardFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(card.id);
    expect(files[0].hash).toHaveLength(64);
    rmSync(root, { recursive: true, force: true });
  });

  it('listCardFiles returns empty when cards dir is absent', async () => {
    const root = tmpRoot();
    expect(await listCardFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — `writeCard` / `listCards` / `listCardFiles` / `readCard` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/store.ts`:

```ts
import { mkdir, readdir, readFile, writeFile, access } from 'fs/promises';
import { join, extname } from 'path';
import { cardsDir, attachmentsDir } from './paths';
import type { NewCard } from '../shared/types';

/** A card file on disk with its raw contents and content hash. */
export interface CardFile {
  id: string;
  filePath: string;
  raw: string;
  hash: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Build the filename stem "YYYYMMDD-HHMMSS-slug" for a card. */
function cardStem(created: Date, body: string): string {
  const date =
    `${created.getFullYear()}${pad(created.getMonth() + 1, 2)}${pad(created.getDate(), 2)}`;
  const time =
    `${pad(created.getHours(), 2)}${pad(created.getMinutes(), 2)}${pad(created.getSeconds(), 2)}`;
  return `${date}-${time}-${slugify(body)}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Pick a stem whose `.md` file does not already exist, appending -2, -3, ... */
async function uniqueStem(root: string, base: string): Promise<string> {
  let stem = base;
  let n = 1;
  while (await exists(join(cardsDir(root), `${stem}.md`))) {
    n += 1;
    stem = `${base}-${n}`;
  }
  return stem;
}

/** Write a new card (and its images) to disk and return the stored Card. */
export async function writeCard(root: string, input: NewCard): Promise<Card> {
  const created = new Date();
  await mkdir(cardsDir(root), { recursive: true });
  await mkdir(attachmentsDir(root), { recursive: true });
  const stem = await uniqueStem(root, cardStem(created, input.body));

  const attachments: string[] = [];
  for (let i = 0; i < input.images.length; i += 1) {
    const img = input.images[i];
    const ext = extname(img.name) || '.png';
    const rel = join('attachments', `${stem}-${i + 1}${ext}`);
    await writeFile(join(root, rel), Buffer.from(img.data));
    attachments.push(rel);
  }

  const card: Card = {
    id: stem,
    created: created.toISOString(),
    body: input.body,
    tags: input.tags,
    attachments
  };
  await writeFile(join(cardsDir(root), `${stem}.md`), serializeCard(card), 'utf8');
  return card;
}

/** List every card file with its raw contents and hash. Empty if no cards dir. */
export async function listCardFiles(root: string): Promise<CardFile[]> {
  let names: string[];
  try {
    names = await readdir(cardsDir(root));
  } catch {
    return [];
  }
  const files: CardFile[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(cardsDir(root), name);
    const raw = await readFile(filePath, 'utf8');
    files.push({ id: name.slice(0, -3), filePath, raw, hash: hashContent(raw) });
  }
  return files;
}

/** All cards, parsed, sorted newest first. */
export async function listCards(root: string): Promise<Card[]> {
  const files = await listCardFiles(root);
  return files
    .map((f) => parseCard(f.raw, f.id))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Read a single card by id, or null if it does not exist. */
export async function readCard(root: string, id: string): Promise<Card | null> {
  try {
    const raw = await readFile(join(cardsDir(root), `${id}.md`), 'utf8');
    return parseCard(raw, id);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS — all store tests green (the newest-first test takes ~1s).

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts test/store.test.ts
git commit -m "feat: add card write/list/read to store"
```

---

## Task 6: Index DB — schema and open

**Files:**
- Create: `src/main/index-db.ts`
- Test: `test/index-db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/index-db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb, initSchema } from '../src/main/index-db';

describe('index-db: schema', () => {
  it('creates the cards, cards_fts and meta tables', () => {
    const db = openDb(':memory:');
    initSchema(db);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(names).toContain('cards');
    expect(names).toContain('cards_fts');
    expect(names).toContain('meta');
    db.close();
  });

  it('is idempotent — initSchema can run twice', () => {
    const db = openDb(':memory:');
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index-db.test.ts`
Expected: FAIL — cannot resolve `../src/main/index-db`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/index-db.ts`:

```ts
import Database from 'better-sqlite3';

export type DB = Database.Database;

/** Open (or create) a SQLite database at `path`. Use ':memory:' for tests. */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return db;
}

/** Create all tables, the FTS5 index, and its sync triggers. Idempotent. */
export function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      created      TEXT NOT NULL,
      body         TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      attachments  TEXT NOT NULL DEFAULT '[]',
      file_path    TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      body, tags, content='cards', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
      INSERT INTO cards_fts(rowid, body, tags) VALUES (new.rowid, new.body, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, body, tags)
        VALUES ('delete', old.rowid, old.body, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, body, tags)
        VALUES ('delete', old.rowid, old.body, old.tags);
      INSERT INTO cards_fts(rowid, body, tags) VALUES (new.rowid, new.body, new.tags);
    END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index-db.test.ts`
Expected: PASS — 2 tests.

If this fails with an ABI/`NODE_MODULE_VERSION` error, run `npm rebuild better-sqlite3` (rebuilds for Node) and retry.

- [ ] **Step 5: Commit**

```bash
git add src/main/index-db.ts test/index-db.test.ts
git commit -m "feat: add SQLite schema with FTS5 index"
```

---

## Task 7: Index DB — upsert, delete, query

**Files:**
- Modify: `src/main/index-db.ts`
- Test: `test/index-db.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/index-db.test.ts`:

```ts
import { upsertCard, deleteCard, getCard, listCards, allHashes, searchFts } from '../src/main/index-db';
import type { Card } from '../src/shared/types';

function sampleCard(over: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    created: '2026-05-21T09:00:00.000Z',
    body: 'the quick brown fox',
    tags: ['animal'],
    attachments: [],
    ...over
  };
}

describe('index-db: upsert/query', () => {
  it('upserts and reads a card back', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    const got = getCard(db, 'c1');
    expect(got?.body).toBe('the quick brown fox');
    expect(got?.tags).toEqual(['animal']);
    db.close();
  });

  it('upsert on the same id updates in place', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    upsertCard(db, sampleCard({ body: 'updated body' }), '/p/c1.md', 'hash2');
    expect(getCard(db, 'c1')?.body).toBe('updated body');
    expect(listCards(db, 100, 0)).toHaveLength(1);
    db.close();
  });

  it('deleteCard removes the row', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    deleteCard(db, 'c1');
    expect(getCard(db, 'c1')).toBeNull();
    db.close();
  });

  it('allHashes maps id to content hash', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'hash1');
    expect(allHashes(db).get('c1')).toBe('hash1');
    db.close();
  });

  it('listCards returns newest first', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard({ id: 'old', created: '2026-01-01T00:00:00.000Z' }), '/p/old.md', 'h');
    upsertCard(db, sampleCard({ id: 'new', created: '2026-09-01T00:00:00.000Z' }), '/p/new.md', 'h');
    expect(listCards(db, 100, 0).map((c) => c.id)).toEqual(['new', 'old']);
    db.close();
  });

  it('searchFts matches body terms and ignores punctuation in the query', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, sampleCard(), '/p/c1.md', 'h');
    expect(searchFts(db, 'brown').map((h) => h.id)).toEqual(['c1']);
    expect(searchFts(db, 'quick!! fox?').map((h) => h.id)).toEqual(['c1']);
    expect(searchFts(db, 'elephant')).toEqual([]);
    expect(searchFts(db, '   ')).toEqual([]);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index-db.test.ts`
Expected: FAIL — `upsertCard` / `getCard` / etc. not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/index-db.ts`:

```ts
import type { Card } from '../shared/types';

interface CardRow {
  id: string;
  created: string;
  body: string;
  tags: string;
  attachments: string;
}

function rowToCard(row: CardRow): Card {
  return {
    id: row.id,
    created: row.created,
    body: row.body,
    tags: JSON.parse(row.tags),
    attachments: JSON.parse(row.attachments)
  };
}

/** Insert a card, or update it in place if its id already exists. */
export function upsertCard(db: DB, card: Card, filePath: string, hash: string): void {
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
}

/** Remove a card from the index. */
export function deleteCard(db: DB, id: string): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

/** Fetch a card by id, or null. */
export function getCard(db: DB, id: string): Card | null {
  const row = db
    .prepare('SELECT id, created, body, tags, attachments FROM cards WHERE id = ?')
    .get(id) as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

/** Cards newest first, paginated. */
export function listCards(db: DB, limit: number, offset: number): Card[] {
  const rows = db
    .prepare(
      'SELECT id, created, body, tags, attachments FROM cards ORDER BY created DESC LIMIT ? OFFSET ?'
    )
    .all(limit, offset) as CardRow[];
  return rows.map(rowToCard);
}

/** Map of card id to its stored content hash. */
export function allHashes(db: DB): Map<string, string> {
  const rows = db.prepare('SELECT id, content_hash FROM cards').all() as {
    id: string;
    content_hash: string;
  }[];
  return new Map(rows.map((r) => [r.id, r.content_hash]));
}

/** Turn a freeform query into a safe FTS5 MATCH expression of quoted terms. */
function ftsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' ');
}

/** Keyword search over body + tags. Returns ids and highlighted snippets, ranked. */
export function searchFts(db: DB, query: string): { id: string; snippet: string }[] {
  const match = ftsQuery(query);
  if (!match) return [];
  return db
    .prepare(
      `SELECT c.id AS id, snippet(cards_fts, 0, '«', '»', '…', 12) AS snippet
       FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH ? ORDER BY rank LIMIT 50`
    )
    .all(match) as { id: string; snippet: string }[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index-db.test.ts`
Expected: PASS — all `index-db: upsert/query` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/index-db.ts test/index-db.test.ts
git commit -m "feat: add card upsert, delete, list and FTS query"
```

---

## Task 8: Index DB — rebuild from disk

**Files:**
- Modify: `src/main/index-db.ts`
- Test: `test/index-db.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/index-db.test.ts`:

```ts
import { rebuildIndex } from '../src/main/index-db';
import { writeCard } from '../src/main/store';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pjoin } from 'path';

describe('index-db: rebuild', () => {
  it('indexes cards found on disk', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    await writeCard(root, { body: 'disk card one', tags: [], images: [] });
    const db = openDb(':memory:');
    initSchema(db);
    await rebuildIndex(db, root);
    expect(listCards(db, 100, 0)).toHaveLength(1);
    expect(searchFts(db, 'disk').length).toBe(1);
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('drops index rows whose card file no longer exists', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(
      db,
      { id: 'ghost', created: '2026-01-01T00:00:00.000Z', body: 'x', tags: [], attachments: [] },
      '/p/ghost.md',
      'h'
    );
    await rebuildIndex(db, root);
    expect(getCard(db, 'ghost')).toBeNull();
    rmSync(root, { recursive: true, force: true });
    db.close();
  });

  it('skips files whose hash is unchanged on a second rebuild', async () => {
    const root = mkdtempSync(pjoin(tmpdir(), 'lg-'));
    await writeCard(root, { body: 'stable card', tags: [], images: [] });
    const db = openDb(':memory:');
    initSchema(db);
    await rebuildIndex(db, root);
    const firstHash = [...allHashes(db).values()][0];
    await rebuildIndex(db, root);
    expect([...allHashes(db).values()][0]).toBe(firstHash);
    rmSync(root, { recursive: true, force: true });
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index-db.test.ts`
Expected: FAIL — `rebuildIndex` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/main/index-db.ts`:

```ts
import { listCardFiles, parseCard } from './store';

/**
 * Reconcile the index with the `cards/` folder: upsert new or changed files,
 * delete index rows whose file is gone, skip files whose hash is unchanged.
 */
export async function rebuildIndex(db: DB, root: string): Promise<void> {
  const files = await listCardFiles(root);
  const known = allHashes(db);
  const onDisk = new Set<string>();

  for (const file of files) {
    onDisk.add(file.id);
    if (known.get(file.id) === file.hash) continue;
    const card = parseCard(file.raw, file.id);
    upsertCard(db, card, file.filePath, file.hash);
  }

  for (const id of known.keys()) {
    if (!onDisk.has(id)) deleteCard(db, id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index-db.test.ts`
Expected: PASS — all `index-db: rebuild` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/main/index-db.ts test/index-db.test.ts
git commit -m "feat: add index rebuild from disk"
```

---

## Task 9: Search module

**Files:**
- Create: `src/main/search.ts`
- Test: `test/search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb, initSchema, upsertCard } from '../src/main/index-db';
import { keywordSearch } from '../src/main/search';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-21T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('search: keyword', () => {
  it('returns matching cards with a snippet', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'meeting notes about pricing'), '/p/a.md', 'h');
    upsertCard(db, card('b', 'unrelated grocery list'), '/p/b.md', 'h');
    const results = keywordSearch(db, 'pricing');
    expect(results).toHaveLength(1);
    expect(results[0].card.id).toBe('a');
    expect(results[0].snippet).toContain('«pricing»');
    db.close();
  });

  it('returns an empty array when nothing matches', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'hello'), '/p/a.md', 'h');
    expect(keywordSearch(db, 'absent')).toEqual([]);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/search.test.ts`
Expected: FAIL — cannot resolve `../src/main/search`.

- [ ] **Step 3: Write minimal implementation**

Create `src/main/search.ts`:

```ts
import type { DB } from './index-db';
import { searchFts, getCard } from './index-db';
import type { SearchResult } from '../shared/types';

/**
 * Phase 1 search: keyword (FTS5) only. Results keep FTS rank order.
 * `score` is a placeholder (1) until Phase 2 introduces semantic ranking.
 */
export function keywordSearch(db: DB, query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const hit of searchFts(db, query)) {
    const card = getCard(db, hit.id);
    if (!card) continue;
    results.push({ card, score: 1, snippet: hit.snippet });
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/search.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across `store`, `index-db`, `search`.

- [ ] **Step 6: Commit**

```bash
git add src/main/search.ts test/search.test.ts
git commit -m "feat: add keyword search module"
```

---

## Task 10: IPC handlers

**Files:**
- Create: `src/main/ipc.ts`

- [ ] **Step 1: Write the implementation**

Create `src/main/ipc.ts`:

```ts
import { ipcMain } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { DB } from './index-db';
import { upsertCard, getCard, listCards, rebuildIndex } from './index-db';
import { writeCard, hashContent } from './store';
import { keywordSearch } from './search';
import { cardsDir } from './paths';
import type { NewCard } from '../shared/types';

/** Register every IPC handler the renderer relies on. Call once at startup. */
export function registerIpc(db: DB, root: string): void {
  ipcMain.handle('card:create', async (_e, input: NewCard) => {
    const card = await writeCard(root, input);
    const filePath = join(cardsDir(root), `${card.id}.md`);
    const raw = await readFile(filePath, 'utf8');
    upsertCard(db, card, filePath, hashContent(raw));
    return card;
  });

  ipcMain.handle('card:list', (_e, limit = 100, offset = 0) => listCards(db, limit, offset));

  ipcMain.handle('card:get', (_e, id: string) => getCard(db, id));

  ipcMain.handle('search:query', (_e, query: string) => keywordSearch(db, query));

  ipcMain.handle('index:rebuild', () => rebuildIndex(db, root));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add IPC handlers"
```

---

## Task 11: Preload bridge

**Files:**
- Modify: `src/preload/index.ts`
- Create: `src/preload/api.d.ts`

- [ ] **Step 1: Write the preload bridge**

Replace the contents of `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Card, NewCard, SearchResult } from '../shared/types';

/** The API exposed to the renderer as `window.localgold`. */
export interface LocalGoldApi {
  createCard(input: NewCard): Promise<Card>;
  listCards(limit?: number, offset?: number): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  search(query: string): Promise<SearchResult[]>;
  rebuild(): Promise<void>;
}

const api: LocalGoldApi = {
  createCard: (input) => ipcRenderer.invoke('card:create', input),
  listCards: (limit, offset) => ipcRenderer.invoke('card:list', limit, offset),
  getCard: (id) => ipcRenderer.invoke('card:get', id),
  search: (query) => ipcRenderer.invoke('search:query', query),
  rebuild: () => ipcRenderer.invoke('index:rebuild')
};

contextBridge.exposeInMainWorld('localgold', api);
```

- [ ] **Step 2: Declare the global for the renderer**

Create `src/preload/api.d.ts`:

```ts
import type { LocalGoldApi } from './index';

declare global {
  interface Window {
    localgold: LocalGoldApi;
  }
}

export {};
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/preload/api.d.ts
git commit -m "feat: expose localgold API via contextBridge"
```

---

## Task 12: Main entry — wire storage into app startup

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the implementation**

Replace the contents of `src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { rootDir, cardsDir, attachmentsDir, dbPath } from './paths';
import { openDb, initSchema, rebuildIndex } from './index-db';
import { registerIpc } from './ipc';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  const root = rootDir();
  await mkdir(cardsDir(root), { recursive: true });
  await mkdir(attachmentsDir(root), { recursive: true });

  const db = openDb(dbPath(root));
  initSchema(db);
  await rebuildIndex(db, root);
  registerIpc(db, root);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire storage and IPC into app startup"
```

---

## Task 13: Renderer — shell and capture view

**Files:**
- Modify: `src/renderer/index.html`, `src/renderer/main.ts`
- Create: `src/renderer/capture.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Write `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>LocalGold</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <nav id="tabs">
      <button id="tab-capture" class="active">Capture</button>
      <button id="tab-library">Library</button>
    </nav>
    <main id="view"></main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/renderer/styles.css`**

```css
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; color: #1a1a1a; }
#tabs { display: flex; gap: 4px; padding: 8px; border-bottom: 1px solid #ddd; }
#tabs button { padding: 6px 14px; border: 0; background: transparent; cursor: pointer; border-radius: 6px; }
#tabs button.active { background: #f0c33c; }
#view { padding: 16px; }
textarea { width: 100%; min-height: 140px; padding: 10px; font: inherit; resize: vertical; }
input[type=text] { width: 100%; padding: 8px; font: inherit; margin-top: 8px; }
.primary { margin-top: 8px; padding: 8px 16px; background: #f0c33c; border: 0; border-radius: 6px; cursor: pointer; }
.card { border: 1px solid #e2e2e2; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.card .meta { color: #888; font-size: 12px; }
.card .tag { display: inline-block; background: #f3f3f3; border-radius: 4px; padding: 1px 6px; margin-right: 4px; }
.card mark { background: #f7e08c; }
.hint { color: #888; }
.thumbs img { max-width: 80px; max-height: 60px; margin-right: 6px; }
```

- [ ] **Step 3: Write `src/renderer/capture.ts`**

```ts
/** Render the capture view into `host`. */
export function renderCapture(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Capture</h2>
    <textarea id="body" placeholder="Write an insight…"></textarea>
    <input id="tags" type="text" placeholder="tags, comma, separated" />
    <div class="thumbs" id="thumbs"></div>
    <p class="hint">Paste an image to attach it.</p>
    <button class="primary" id="save">Save card</button>
    <span id="status" class="hint"></span>
  `;

  const body = host.querySelector<HTMLTextAreaElement>('#body')!;
  const tags = host.querySelector<HTMLInputElement>('#tags')!;
  const thumbs = host.querySelector<HTMLDivElement>('#thumbs')!;
  const status = host.querySelector<HTMLSpanElement>('#status')!;
  const images: { name: string; data: Uint8Array }[] = [];

  body.addEventListener('paste', async (e) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      const name = file.name || `pasted.${item.type.split('/')[1] || 'png'}`;
      images.push({ name, data });
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      thumbs.appendChild(img);
    }
  });

  host.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', async () => {
    const text = body.value.trim();
    if (!text) {
      status.textContent = 'Nothing to save.';
      return;
    }
    const tagList = tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    await window.localgold.createCard({ body: text, tags: tagList, images });
    body.value = '';
    tags.value = '';
    images.length = 0;
    thumbs.innerHTML = '';
    status.textContent = 'Saved.';
  });
}
```

- [ ] **Step 4: Write `src/renderer/main.ts`**

```ts
import { renderCapture } from './capture';

const view = document.getElementById('view')!;
const tabCapture = document.getElementById('tab-capture')!;
const tabLibrary = document.getElementById('tab-library')!;

function select(active: HTMLElement, other: HTMLElement): void {
  active.classList.add('active');
  other.classList.remove('active');
}

tabCapture.addEventListener('click', () => {
  select(tabCapture, tabLibrary);
  renderCapture(view);
});

tabLibrary.addEventListener('click', () => {
  select(tabLibrary, tabCapture);
  view.innerHTML = '<p class="hint">Library — added in Task 14.</p>';
});

renderCapture(view);
```

- [ ] **Step 5: Verify capture works end to end**

Run: `npm run dev`
Expected: the Capture tab shows a textarea. Type text, optionally add a tag, click "Save card" — status shows "Saved." Confirm a new `.md` file appeared in `~/Documents/LocalGold/cards/`. Close the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat: add renderer shell and capture view"
```

---

## Task 14: Renderer — library and search view

**Files:**
- Create: `src/renderer/library.ts`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: Write `src/renderer/library.ts`**

```ts
import type { Card } from '../shared/types';

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
  return `<div class="card">
    <div class="meta">${escapeHtml(card.created)}</div>
    <div>${text}</div>
    <div>${tags}</div>${attach}
  </div>`;
}

/** Render the library / search view into `host`. */
export function renderLibrary(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Library</h2>
    <input id="q" type="text" placeholder="Search cards…" />
    <div id="results"></div>
  `;
  const q = host.querySelector<HTMLInputElement>('#q')!;
  const results = host.querySelector<HTMLDivElement>('#results')!;

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

  void showAll();
}
```

- [ ] **Step 2: Wire the library tab in `src/renderer/main.ts`**

Replace the `tabLibrary` click handler:

```ts
tabLibrary.addEventListener('click', () => {
  select(tabLibrary, tabCapture);
  renderLibrary(view);
});
```

And add the import at the top:

```ts
import { renderLibrary } from './library';
```

- [ ] **Step 3: Verify search works end to end**

Run: `npm run dev`
Expected: capture two cards with different words. Switch to Library — both appear, newest first. Type a word from one card — only that card shows, with the matching term highlighted. Clear the box — all cards return. Close the app.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/library.ts src/renderer/main.ts
git commit -m "feat: add library and keyword search view"
```

---

## Task 15: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test in `store`, `index-db`, `search`.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify rebuild-from-disk survives a fresh index**

Run: with the app closed, delete `~/Documents/LocalGold/index.db*`, then `npm run rebuild && npm run dev`.
Expected: the app launches and the Library tab still lists every previously captured card (the index was rebuilt from `cards/`).

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 1 complete — capture, storage, keyword search" --allow-empty
```

---

## Phase 1 Done

The app captures cards as Markdown on disk, indexes them in a rebuildable SQLite database with FTS5, and supports keyword search. No AI dependency. Phase 2 (EmbeddingGemma semantic search) and Phase 3 (Gemma 4 synthesized answers) build on this foundation and will be planned separately.
