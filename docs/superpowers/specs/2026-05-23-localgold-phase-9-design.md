# LocalGold Phase 9 — User-Chosen Data Folder — Design

**Date:** 2026-05-23
**Status:** Approved for planning
**Builds on:** Phases 1–8 (capture, hybrid search, answers, visual refresh, image picker + URL, AI enrichment, voice notes — shipped on `main`)

## Overview

Phase 9 lets the user pick the folder where LocalGold stores its data. Today
the path is hardcoded to `~/Documents/LocalGold` (with a `LOCALGOLD_DIR` env
override). After Phase 9 a small Settings tab shows the current folder, lets
the user pick another with the native folder picker, persists the choice
across launches, and applies it after a restart.

## Goals

- The user can move LocalGold's data anywhere (iCloud, Dropbox, an external
  drive, a project folder).
- The choice persists across launches without depending on a launch-time env
  var.
- The setting lives somewhere the user expects (a Settings tab).
- Reverting to the default is easy.

## Non-Goals

- Auto-migrating cards/attachments/index from the old folder to the new one
  (Finder handles that).
- Multiple "vaults" / switching folders without restarting.
- Settings for anything other than the data folder (the file is structured so
  more can be added later, but no other setting is added in this phase).

## Where the setting lives

The dataDir override **cannot** live inside the data folder — that is
circular: we need to know the folder before we can read any file in it. It
lives in Electron's standard per-user app-data location:

```
~/Library/Application Support/LocalGold/preferences.json
```

Shape:

```json
{ "dataDir": "/absolute/path/to/folder" }
```

A missing or malformed file is treated as "no preference"; the app falls back
to the default `~/Documents/LocalGold`.

The existing `config.json` (Ollama URL, model names) stays *inside* the data
folder, unchanged.

## Architecture & Modules

### `src/main/preferences.ts` (new)

```ts
export interface Preferences { dataDir: string; }
export function defaultDataDir(): string;                      // ~/Documents/LocalGold
export function loadPreferences(userDataDir: string): Preferences;
export function savePreferences(userDataDir: string, prefs: Preferences): void;
```

`userDataDir` is injected (rather than read from Electron's `app` inside the
module) so the module is pure-testable with a temp dir. The Electron caller
passes `app.getPath('userData')`.

### `src/main/index.ts`

At startup:

```ts
const prefs = loadPreferences(app.getPath('userData'));
const root = prefs.dataDir;
```

Everything downstream (`cardsDir(root)`, `attachmentsDir(root)`,
`dbPath(root)`, `loadConfig(root)`, `registerIpc(db, root, …)`) follows the
existing pattern with the new `root`.

### `src/main/ipc.ts`

Four new handlers:

- `preferences:get` — returns `Preferences` (the resolved current value, not
  the on-disk file — so it reflects the default when no file exists).
- `dialog:pick-folder` — runs `dialog.showOpenDialog({ properties:
  ['openDirectory', 'createDirectory'] })`. Returns the selected absolute
  path or `null` if cancelled.
- `preferences:set` — accepts a new `Preferences` and writes it to
  `preferences.json`. Returns the saved value.
- `shell:reveal-folder` — `shell.openPath(path)`; returns nothing.
- `app:restart` — `app.relaunch(); app.exit(0)`.

### `src/preload/index.ts`

Exposes the matching `getPreferences`, `pickFolder`, `setPreferences`,
`revealFolder`, `restartApp` methods on `window.localgold`.

### Renderer

- **`src/renderer/settings.ts`** (new) — `renderSettings(host)` draws the
  small Settings UI; reads via `getPreferences`, drives the buttons.
- **`src/renderer/main.ts`** — adds the Settings tab handler (alongside
  Capture and Library).
- **`src/renderer/index.html`** — adds the Settings tab button.

## UI Flow

The Settings view contains one section in this phase — the data folder:

- The current folder is shown as plain text.
- **Choose folder…** opens the native folder picker. On selection, the new
  path is saved via `preferences:set` and a small block appears:
  "Data folder will change to `<new>` on restart. **[Restart now]**".
- **Reveal in Finder** opens the current folder.
- **Restart now** triggers `app:restart` (`app.relaunch(); app.exit(0)`).
  The next launch reads the saved preference and resolves all paths against
  it.

Picking the same folder you already use is a no-op (no restart prompt).

There is **no auto-migration**. If the user wants to bring history along, they
move the `cards/`, `attachments/`, `config.json` (and optionally `index.db`)
from the old folder to the new one in Finder before restarting. If the new
folder is empty, the Library starts empty; if it already contains a `cards/`
folder, the existing startup rebuild picks the cards up automatically.

## Error Handling

- **Dialog cancelled** — `pickFolder` returns `null`; the UI does nothing.
- **`preferences.json` malformed or missing** — treated as no preference; the
  app falls back to the default. (No crash, no banner — this is the normal
  first-run state.)
- **Picked folder unreadable / uncreatable at startup** — the existing
  `mkdir({ recursive: true })` step would throw. To keep the app usable, the
  startup is wrapped: if creating the resolved `dataDir` fails, the app falls
  back to the default folder and a small banner in Settings says "Could not
  use the chosen folder; falling back to `~/Documents/LocalGold`." The
  malformed preference is left in place so the user can fix or replace it.

## Testing

- **`preferences.ts`** — unit tests against a temp `userDataDir`:
  - Returns the default `dataDir` when `preferences.json` is absent.
  - Returns the saved `dataDir` after a valid write.
  - Falls back to the default when `preferences.json` is malformed JSON.
  - Falls back to the default when `dataDir` is the wrong type.
- The dialog, restart, reveal, the Settings UI and the startup fallback
  banner are Electron/renderer glue with no unit tests — verified in the
  `npm run dev` GUI pass: pick a new (empty) folder, restart, capture a card,
  confirm it lands in the new folder; revert and confirm cards from the
  default folder come back.
- The full `npm test` suite must continue to pass.
