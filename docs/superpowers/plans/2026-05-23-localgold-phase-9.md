# LocalGold Phase 9 — User-Chosen Data Folder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the folder where LocalGold stores its data, persist the choice across launches in `<userData>/preferences.json`, and apply it after restart.

**Architecture:** A new `preferences.ts` module reads/writes a small JSON file at Electron's per-user app-data path (out of the data folder, to avoid circularity). Startup resolves the dataDir from this file (falling back to the default if the chosen folder is unusable) and uses it everywhere. New IPCs expose the picker, the get/set, Finder reveal, and restart; a new Settings tab drives them.

**Tech Stack:** Electron (`dialog`, `shell`, `app`), TypeScript, Vitest.

---

## File Structure

```
src/
  shared/types.ts        — MODIFY: add Preferences
  main/preferences.ts    — CREATE: loadPreferences / savePreferences / defaultDataDir
  main/ipc.ts            — MODIFY: add userDataDir param + 5 new handlers
  main/index.ts          — MODIFY: resolve root from prefs, fallback on failure
  preload/index.ts       — MODIFY: expose 5 new methods
  renderer/settings.ts   — CREATE: Settings view
  renderer/main.ts       — MODIFY: Settings tab
  renderer/index.html    — MODIFY: Settings tab button
  renderer/styles.css    — MODIFY: settings styles
test/
  preferences.test.ts    — CREATE
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as prior phases).

---

## Task 1: preferences module

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/preferences.ts`
- Test: `test/preferences.test.ts`

- [ ] **Step 1: Add the shared type**

Append to `src/shared/types.ts`:

```ts
/** User preferences, persisted outside the data folder. */
export interface Preferences {
  /** Absolute path of the folder where cards / attachments / index.db live. */
  dataDir: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/preferences.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadPreferences, savePreferences, defaultDataDir } from '../src/main/preferences';

function tmpUserData(): string {
  return mkdtempSync(join(tmpdir(), 'lg-ud-'));
}

describe('preferences', () => {
  it('returns the default dataDir when no preferences file exists', () => {
    const ud = tmpUserData();
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });

  it('round-trips a saved preference', () => {
    const ud = tmpUserData();
    savePreferences(ud, { dataDir: '/some/path' });
    expect(loadPreferences(ud)).toEqual({ dataDir: '/some/path' });
    rmSync(ud, { recursive: true, force: true });
  });

  it('falls back to the default when preferences.json is malformed', () => {
    const ud = tmpUserData();
    writeFileSync(join(ud, 'preferences.json'), '{ not valid json');
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });

  it('falls back to the default when dataDir is the wrong type', () => {
    const ud = tmpUserData();
    writeFileSync(join(ud, 'preferences.json'), JSON.stringify({ dataDir: 123 }));
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm rebuild better-sqlite3 && npx vitest run test/preferences.test.ts`
Expected: FAIL — cannot resolve `../src/main/preferences`.

- [ ] **Step 4: Write minimal implementation**

Create `src/main/preferences.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Preferences } from '../shared/types';

/** The factory default for `dataDir`. */
export function defaultDataDir(): string {
  return join(homedir(), 'Documents', 'LocalGold');
}

function prefsPath(userDataDir: string): string {
  return join(userDataDir, 'preferences.json');
}

/**
 * Read preferences from `<userDataDir>/preferences.json`. Missing, malformed,
 * or wrong-shape files fall back to the default `{ dataDir }`.
 */
export function loadPreferences(userDataDir: string): Preferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(prefsPath(userDataDir), 'utf8'));
  } catch {
    return { dataDir: defaultDataDir() };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { dataDir: defaultDataDir() };
  }
  const p = parsed as { dataDir?: unknown };
  return {
    dataDir: typeof p.dataDir === 'string' && p.dataDir ? p.dataDir : defaultDataDir()
  };
}

/** Persist preferences to `<userDataDir>/preferences.json`. */
export function savePreferences(userDataDir: string, prefs: Preferences): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(prefsPath(userDataDir), JSON.stringify(prefs, null, 2), 'utf8');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/preferences.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/preferences.ts test/preferences.test.ts
git commit -m "feat: add preferences module for dataDir override"
```

---

## Task 2: IPC handlers + Settings/restart support

**Files:**
- Modify: `src/main/ipc.ts`

- [ ] **Step 1: Extend the Electron import**

In `src/main/ipc.ts`, change the Electron import:

```ts
import { ipcMain, dialog } from 'electron';
```

to:

```ts
import { app, ipcMain, dialog, shell } from 'electron';
```

- [ ] **Step 2: Import the preferences module**

In `src/main/ipc.ts`, add this import alongside the other `./` imports:

```ts
import { loadPreferences, savePreferences } from './preferences';
import type { Preferences } from '../shared/types';
```

- [ ] **Step 3: Add `userDataDir` to `registerIpc`**

Change the signature:

```ts
export function registerIpc(db: DB, root: string, ollama: Ollama, model: string): void {
```

to:

```ts
export function registerIpc(
  db: DB,
  root: string,
  ollama: Ollama,
  model: string,
  userDataDir: string
): void {
```

- [ ] **Step 4: Add the five new handlers**

Inside `registerIpc`, add this block after the `read:attachment` handler:

```ts
  ipcMain.handle('preferences:get', () => loadPreferences(userDataDir));

  ipcMain.handle('preferences:set', (_e, prefs: Preferences) => {
    savePreferences(userDataDir, prefs);
    return prefs;
  });

  ipcMain.handle('runtime:data-dir', () => root);

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('shell:reveal-folder', async (_e, path: string) => {
    await shell.openPath(path);
  });

  ipcMain.handle('app:restart', () => {
    app.relaunch();
    app.exit(0);
  });
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: an error on `registerIpc` being called with 4 args (handled in Task 3).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts
git commit -m "feat: add preferences, picker, reveal and restart IPCs"
```

---

## Task 3: main/index.ts — resolve root from preferences with fallback

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the preferences import**

In `src/main/index.ts`, add this import:

```ts
import { loadPreferences, defaultDataDir } from './preferences';
```

- [ ] **Step 2: Drop the static `rootDir` import**

In `src/main/index.ts`, change:

```ts
import { rootDir, cardsDir, attachmentsDir, dbPath } from './paths';
```

to:

```ts
import { cardsDir, attachmentsDir, dbPath } from './paths';
```

- [ ] **Step 3: Resolve `root` from preferences, with fallback**

Replace the block inside `app.whenReady().then(async () => {`:

```ts
  const root = rootDir();
  await mkdir(cardsDir(root), { recursive: true });
  await mkdir(attachmentsDir(root), { recursive: true });
```

with:

```ts
  const userDataDir = app.getPath('userData');
  const prefs = loadPreferences(userDataDir);
  let root = prefs.dataDir;
  try {
    await mkdir(cardsDir(root), { recursive: true });
    await mkdir(attachmentsDir(root), { recursive: true });
  } catch {
    // The chosen folder is unusable — fall back to the default so the app
    // still starts. Settings will surface the mismatch.
    root = defaultDataDir();
    await mkdir(cardsDir(root), { recursive: true });
    await mkdir(attachmentsDir(root), { recursive: true });
  }
```

- [ ] **Step 4: Pass `userDataDir` into `registerIpc`**

Change:

```ts
  registerIpc(db, root, ollama, config.embedModel);
```

to:

```ts
  registerIpc(db, root, ollama, config.embedModel, userDataDir);
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: resolve data folder from preferences with fallback"
```

---

## Task 4: Preload — Settings methods

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add `Preferences` to the import**

In `src/preload/index.ts`, change the type import to include `Preferences`:

```ts
import type {
  Card,
  NewCard,
  SearchResult,
  OllamaStatus,
  AnswerResult,
  Enrichment,
  Preferences
} from '../shared/types';
```

- [ ] **Step 2: Add the five methods to `LocalGoldApi`**

Add these methods to the `LocalGoldApi` interface (after `readAttachment`):

```ts
  getPreferences(): Promise<Preferences>;
  setPreferences(prefs: Preferences): Promise<Preferences>;
  getEffectiveDataDir(): Promise<string>;
  pickFolder(): Promise<string | null>;
  revealFolder(path: string): Promise<void>;
  restartApp(): Promise<void>;
```

- [ ] **Step 3: Add the five properties to the `api` object**

Add these properties to the `api` object (after `readAttachment`):

```ts
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (prefs) => ipcRenderer.invoke('preferences:set', prefs),
  getEffectiveDataDir: () => ipcRenderer.invoke('runtime:data-dir'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  revealFolder: (path) => ipcRenderer.invoke('shell:reveal-folder', path),
  restartApp: () => ipcRenderer.invoke('app:restart'),
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose Settings IPCs in preload"
```

---

## Task 5: Renderer — Settings tab and view

**Files:**
- Create: `src/renderer/settings.ts`
- Modify: `src/renderer/index.html`, `src/renderer/main.ts`, `src/renderer/styles.css`

- [ ] **Step 1: Create `src/renderer/settings.ts`**

```ts
function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Render the settings view into `host`. */
export function renderSettings(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Settings</h2>
    <div class="setting">
      <h3>Data folder</h3>
      <div id="data-folder" class="path"></div>
      <div id="fallback" class="problem"></div>
      <div class="row">
        <button class="secondary" id="pick-folder">Choose folder…</button>
        <button class="secondary" id="reveal">Reveal in Finder</button>
      </div>
      <div id="pending"></div>
    </div>
  `;

  const folderEl = host.querySelector<HTMLDivElement>('#data-folder')!;
  const fallbackEl = host.querySelector<HTMLDivElement>('#fallback')!;
  const pendingEl = host.querySelector<HTMLDivElement>('#pending')!;

  async function refresh(): Promise<void> {
    const [prefs, effective] = await Promise.all([
      window.localgold.getPreferences(),
      window.localgold.getEffectiveDataDir()
    ]);
    folderEl.textContent = effective;
    if (prefs.dataDir !== effective) {
      fallbackEl.textContent =
        `Saved preference is ${prefs.dataDir} but couldn't be used; ` +
        `falling back to ${effective}.`;
    } else {
      fallbackEl.textContent = '';
    }
  }

  host.querySelector<HTMLButtonElement>('#pick-folder')!.addEventListener('click', async () => {
    const picked = await window.localgold.pickFolder();
    if (!picked) return;
    const effective = await window.localgold.getEffectiveDataDir();
    if (picked === effective) return;
    await window.localgold.setPreferences({ dataDir: picked });
    pendingEl.innerHTML =
      `<p class="hint">Data folder will change to <code>${escapeHtml(picked)}</code> ` +
      `on restart.</p><button class="primary" id="restart">Restart now</button>`;
    pendingEl.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', () => {
      void window.localgold.restartApp();
    });
  });

  host.querySelector<HTMLButtonElement>('#reveal')!.addEventListener('click', async () => {
    const effective = await window.localgold.getEffectiveDataDir();
    await window.localgold.revealFolder(effective);
  });

  void refresh();
}
```

- [ ] **Step 2: Add the Settings tab to `index.html`**

In `src/renderer/index.html`, change:

```html
    <nav id="tabs">
      <button id="tab-capture" class="active">Capture</button>
      <button id="tab-library">Library</button>
    </nav>
```

to:

```html
    <nav id="tabs">
      <button id="tab-capture" class="active">Capture</button>
      <button id="tab-library">Library</button>
      <button id="tab-settings">Settings</button>
    </nav>
```

- [ ] **Step 3: Wire the Settings tab in `main.ts`**

Replace the entire contents of `src/renderer/main.ts`:

```ts
import '@fontsource-variable/onest/index.css';
import { renderCapture } from './capture';
import { renderLibrary } from './library';
import { renderSettings } from './settings';

const view = document.getElementById('view')!;
const tabCapture = document.getElementById('tab-capture')!;
const tabLibrary = document.getElementById('tab-library')!;
const tabSettings = document.getElementById('tab-settings')!;

function selectTab(active: HTMLElement): void {
  for (const t of [tabCapture, tabLibrary, tabSettings]) t.classList.remove('active');
  active.classList.add('active');
}

tabCapture.addEventListener('click', () => {
  selectTab(tabCapture);
  renderCapture(view);
});

tabLibrary.addEventListener('click', () => {
  selectTab(tabLibrary);
  renderLibrary(view);
});

tabSettings.addEventListener('click', () => {
  selectTab(tabSettings);
  renderSettings(view);
});

renderCapture(view);
```

- [ ] **Step 4: Add settings styles**

Append to `src/renderer/styles.css`:

```css
.setting { margin-bottom: 18px; }
.setting h3 { margin: 0 0 6px; font-size: 13px; }
.path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 10px;
  margin-bottom: 8px;
}
#fallback:empty { display: none; }
#pending:empty { display: none; }
#pending code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/settings.ts src/renderer/main.ts src/renderer/index.html src/renderer/styles.css
git commit -m "feat: add Settings tab with data-folder picker"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, including the new `preferences` tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the running app**

Run: `npm run rebuild && npm run dev`

- Open the **Settings** tab. The Data folder shows
  `/Users/<you>/Documents/LocalGold`.
- Click **Choose folder…**, pick a different empty folder, e.g. on the
  Desktop. A "Restart now" button appears.
- Click **Restart now**. After relaunch, the Library shows no cards. Go to
  **Capture**, save a card. Confirm the card's `.md` file appears in the new
  folder you picked.
- Open **Settings** again, click **Choose folder…** and pick the original
  `~/Documents/LocalGold`. Restart. The Library shows your previous cards
  again.
- Click **Reveal in Finder** — the current folder opens in Finder.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 9 complete — user-chosen data folder" --allow-empty
```

---

## Phase 9 Done

The user can pick where LocalGold stores its data from a new Settings tab.
The choice persists across launches in `<userData>/preferences.json` (outside
the data folder, to avoid circularity) and applies after a restart. If the
chosen folder becomes unusable, startup falls back to the default and Settings
surfaces the mismatch. The test suite passes.
