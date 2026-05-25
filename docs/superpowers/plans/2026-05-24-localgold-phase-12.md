# LocalGold Phase 12 — Real Build (macOS arm64) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable, unsigned macOS arm64 `LocalGold.app` and `.dmg` via a single `npm run dist` command.

**Architecture:** Add `electron-builder` as a devDependency; embed its config in `package.json` under `"build"`; generate `build/icon.icns` from the existing PNG via macOS `iconutil`; mark the two native modules (`better-sqlite3`, `onnxruntime-node`) as ASAR-unpacked so their `.node` binaries load at runtime; ship a short `BUILD.md`.

**Tech Stack:** electron-builder, macOS `iconutil` / `sips`, Electron, electron-vite.

---

## File Structure

```
build/
  icon.png              — EXISTS (1024px hand-drawn amber Gold icon)
  icon.icns             — CREATE (generated from icon.png)
package.json            — MODIFY: add electron-builder devDep, "build" config, "dist" script
BUILD.md                — CREATE: user-facing first-open + install notes
```

No source code changes. No tests added.

**Note on `better-sqlite3` ABI:** the dev loop is unchanged. `npm run rebuild`
before `npm run dev`, `npm rebuild better-sqlite3` before `npm test`.
Packaging triggers its own Electron-targeted rebuild via electron-builder.

---

## Task 1: Generate `build/icon.icns`

**Files:**
- Create: `build/icon.icns`

- [ ] **Step 1: Build the .iconset and convert to .icns**

Run from the repo root:

```bash
mkdir -p build/icon.iconset
sips -z 16 16   build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32   build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32   build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64   build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128 build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256 build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256 build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512 build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512 build/icon.png --out build/icon.iconset/icon_512x512.png
cp              build/icon.png      build/icon.iconset/icon_512x512@2x.png
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset
file build/icon.icns
```

Expected: `build/icon.icns: Mac OS X icon, …`

- [ ] **Step 2: Commit**

```bash
git add build/icon.icns
git commit -m "build: add icns icon generated from icon.png"
```

---

## Task 2: Install electron-builder, add config + dist script

**Files:**
- Modify: `package.json` (via npm + edit)

- [ ] **Step 1: Install electron-builder**

Run: `npm install --save-dev electron-builder`
Expected: package added to `devDependencies`.

- [ ] **Step 2: Add the `dist` script**

In `package.json`, inside the `"scripts"` block, add this line (after the
existing `"rebuild"` script):

```json
    "dist": "electron-vite build && electron-builder --mac"
```

- [ ] **Step 3: Add the `build` config block**

In `package.json`, after the `"devDependencies"` block (i.e. at the top
level), add this `"build"` object:

```json
  "build": {
    "appId": "com.localgold.app",
    "productName": "LocalGold",
    "directories": {
      "output": "dist",
      "buildResources": "build"
    },
    "files": [
      "out/**/*",
      "package.json"
    ],
    "asar": true,
    "asarUnpack": [
      "node_modules/better-sqlite3/**/*",
      "node_modules/onnxruntime-node/**/*"
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "icon": "build/icon.icns",
      "identity": null,
      "hardenedRuntime": false,
      "target": [
        { "target": "dmg", "arch": "arm64" },
        { "target": "dir", "arch": "arm64" }
      ]
    },
    "dmg": {
      "title": "LocalGold ${version}",
      "writeUpdateInfo": false
    }
  }
```

The `asarUnpack` patterns are load-bearing: Node cannot `require` a `.node`
native binary from inside an asar archive, so both native modules
(`better-sqlite3` and `onnxruntime-node` — pulled in by
`@huggingface/transformers`) must be unpacked beside the asar.

`"identity": null` is the explicit "do not sign" flag.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add electron-builder config and dist script"
```

---

## Task 3: User-facing `BUILD.md`

**Files:**
- Create: `BUILD.md`

- [ ] **Step 1: Create `BUILD.md`**

```markdown
# Building LocalGold

## Produce a real .app + .dmg

Apple Silicon Mac, one command:

```bash
npm install            # once
npm run dist
```

Output, in `dist/`:

- `LocalGold-<version>-arm64.dmg` — drag-to-Applications installer
- `mac-arm64/LocalGold.app/` — raw app bundle

## First open

LocalGold is **not code-signed** (no Apple Developer account needed). The
first time you open it, macOS Gatekeeper will refuse with
"LocalGold can't be opened because it is from an unidentified developer."

Two ways to allow it:

1. Right-click the app in Finder → **Open** → click **Open** in the dialog.
   macOS remembers; the second open onwards is silent.
2. Or once, from the terminal:
   `xattr -d com.apple.quarantine /Applications/LocalGold.app`

## What the app still needs

- **Ollama** running locally with the models pulled:
  `ollama pull embeddinggemma` and `ollama pull gemma4:e4b`.
- **First voice transcription** downloads the Whisper model (~145 MB) to
  `~/.cache/huggingface/`. Subsequent transcriptions are offline.

## Where your data lives

- Cards: `~/Documents/LocalGold/` by default (changeable in **Settings**).
- App preferences: `~/Library/Application Support/LocalGold/preferences.json`.

## Re-building

`dist/` is gitignored. Re-running `npm run dist` overwrites it.
```

- [ ] **Step 2: Commit**

```bash
git add BUILD.md
git commit -m "docs: BUILD.md — packaging + first-open notes"
```

---

## Task 4: Build the .app + .dmg and verify

**Files:** none (verification only)

- [ ] **Step 1: Make sure tests pass and types are clean before the build**

Run: `npm rebuild better-sqlite3 && npm test && npx tsc --noEmit`
Expected: 99 tests pass, no TS errors.

- [ ] **Step 2: Run the packager**

Run: `npm run dist`
Expected output (over a couple of minutes):
- `electron-vite build` produces `out/main`, `out/preload`, `out/renderer`.
- electron-builder rebuilds `better-sqlite3` against Electron's Node ABI.
- electron-builder packs the asar with the unpack patterns honoured.
- The `.dmg` is created in `dist/`.

The final log line should mention `target=DMG` and the produced file path.

- [ ] **Step 3: Confirm the artefacts exist**

Run:

```bash
ls -lh dist/*.dmg
ls -la dist/mac-arm64/LocalGold.app
```

Expected: a `.dmg` of ~250 MB, and a real `LocalGold.app` bundle (a
`Contents/` directory inside).

- [ ] **Step 4: Install and smoke-test the packaged app**

Manual steps (run by the human / you, one at a time):

```bash
open dist/LocalGold-*.dmg
# Drag LocalGold to Applications in the mounted DMG window.
# Eject the DMG.
# In Finder, navigate to /Applications.
# Right-click LocalGold → Open → click Open in the Gatekeeper dialog.
```

Verify, in the running packaged app:
- The dock icon shows the amber "Gold" icon.
- The Library tab shows the existing cards from `~/Documents/LocalGold` (no
  migration needed; the packaged app uses the same default folder).
- Capture a new card with some text and a tag; click Save card; confirm it
  appears in the Library.
- Hit **⌘+Enter** with a query that should have matches — Gemma streams an
  answer with `[n]` citations.
- Click **📸 Screenshot**, drag a region, draw an arrow, click Done.
- Click **🎙 Record**, speak one sentence, click Stop; transcript appears
  under `## Voice` (first time downloads Whisper).
- **Settings** tab shows the data folder; **Choose folder…** opens the
  native picker.

If any step fails, see Step 5.

- [ ] **Step 5: If a packaged-app launch error appears**

The two most common failures and their fixes:

- **`Error: Cannot find module 'better_sqlite3.node'`** — the asarUnpack
  pattern for better-sqlite3 didn't take. Re-check Task 2 Step 3 has
  `"node_modules/better-sqlite3/**/*"` in `asarUnpack`, then rebuild
  (`npm run dist`).
- **`Error: Could not locate the bindings file` (onnxruntime-node)** — same
  fix for the `onnxruntime-node` pattern.

- [ ] **Step 6: Commit any tweaks**

If you adjusted `package.json` to fix a runtime error, commit:

```bash
git add package.json
git commit -m "build: tweak asarUnpack for runtime"
```

Otherwise, mark the phase done:

```bash
git commit -m "chore: Phase 12 complete — real macOS arm64 build" --allow-empty
```

---

## Phase 12 Done

`npm run dist` produces a real, draggable `LocalGold.app` inside a `.dmg` —
unsigned, arm64-only, ~250 MB. First open uses the Gatekeeper right-click
once; thereafter the app launches like any other macOS application. All
prior phases' features continue to work in the packaged build. The dev
loop is unchanged.
