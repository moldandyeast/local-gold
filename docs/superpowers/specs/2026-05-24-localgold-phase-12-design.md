# LocalGold Phase 12 — Real Build (macOS arm64) — Design

**Date:** 2026-05-24
**Status:** Approved for planning
**Builds on:** Phases 1–11 — shipped on `main`

## Overview

Phase 12 turns LocalGold from a `npm run dev` project into an installable
macOS application. Output is an unsigned `.dmg` (drag-to-Applications) plus
the raw `LocalGold.app` bundle, both Apple Silicon (arm64). No new feature
work, no behaviour changes — just packaging.

## Goals

- One command (`npm run dist`) produces a usable `LocalGold.app` and a `.dmg`
  for the macOS desktop.
- All current features work in the packaged app: capture, hybrid search,
  ⌘+Enter Gemma answers, AI enrichment, voice notes (Whisper), screenshots,
  user-chosen data folder.
- Native modules (`better-sqlite3`) and bundled assets (fonts, Lucide SVGs,
  the app icon) end up correctly in the `.app`.
- The dev loop (`npm run dev`, `npm test`, `npm run rebuild`) is unchanged.

## Non-Goals

- Code signing with an Apple Developer ID (out of scope; unsigned only).
- Notarization (requires signing first).
- Apple App Store distribution.
- Universal binary (arm64 only — modern Macs).
- Windows or Linux targets.
- Auto-update / `electron-updater` integration.
- Bundling Ollama or the Whisper model into the installer (both remain
  outside the .dmg; the app still depends on the user having Ollama
  installed and Whisper still downloads on first use).

## Architecture & Tool

- **electron-builder** as the packager (devDependency). It is the standard
  Electron tool for `.app`/`.dmg` output and handles:
  - native-module rebuild against Electron's Node ABI
    (delegates to the existing `@electron/rebuild`)
  - ASAR packing of the JS bundle
  - macOS `.icns` icon embedding
  - `.dmg` window layout
- **Build config** lives in `package.json` under a top-level `"build"` key —
  single source of truth, no separate yaml.

### `package.json` `"build"` config

```jsonc
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

`"identity": null` is the explicit "do not sign" flag.

## Icon

The existing `build/icon.png` (1024 px, the hand-drawn amber "Gold" card)
is the source. Phase 12 generates `build/icon.icns` once via macOS's native
`iconutil` and commits both files to the repo. The plan includes the exact
shell incantation.

## Scripts

`package.json` gets one new script:

```jsonc
"scripts": {
  "dist": "electron-vite build && electron-builder --mac"
}
```

Existing `dev`, `build`, `start`, `test`, `rebuild` remain.

## Build Outputs

In `dist/`:

- `LocalGold-<version>-arm64.dmg` — drag-to-Applications installer (~250 MB).
- `mac-arm64/LocalGold.app/` — raw bundle; can be moved/copied anywhere.

`dist/` is already in `.gitignore`.

## User-facing Caveats

These belong in a brief `BUILD.md` (or README addition) committed with the
phase so the user remembers the rough edges:

- **First open is blocked by Gatekeeper.** The .app is unsigned. Right-click
  the app icon in Finder → **Open** the first time; macOS remembers.
  Alternatively, run once: `xattr -d com.apple.quarantine /Applications/LocalGold.app`.
- **AI features still need Ollama running** (`ollama serve`, plus the
  `embeddinggemma` and `gemma4:e4b` models pulled).
- **First voice transcription downloads Whisper** (~145 MB) to
  `~/.cache/huggingface/` — packaged-app behaviour identical to dev.
- **Default data folder is `~/Documents/LocalGold`**; the Settings tab can
  change it (Phase 9).
- **Existing dev cards are immediately visible** in the packaged app since
  the default folder is the same — no migration step.

## Native modules

The build relies on `@electron/rebuild` (already a devDep) being invoked by
electron-builder during `--mac` to rebuild `better-sqlite3` for Electron's
Node ABI. No additional code; it Just Works because `better-sqlite3` is in
`dependencies` (not `devDependencies`).

`@huggingface/transformers` is pure JS + WASM; no rebuild needed. ONNX
runtime files are pulled in transitively and packaged by electron-builder
inside the asar (or unpacked if the package declares it; the default works).

`lucide-static` SVGs and the Fontsource woff2 files are bundled into the
renderer assets by Vite at `electron-vite build` time; they live inside the
packaged `out/renderer/` and are read via `file://` from inside the asar.

## Error Handling

- If `electron-builder` cannot find `build/icon.icns`, the build aborts with
  a clear error — the icon-conversion step in the plan creates it before
  `npm run dist` is ever run.
- If a native-module rebuild fails (unlikely; `better-sqlite3` ships prebuilt
  binaries), the build aborts. The fix is to delete `node_modules` and
  reinstall.
- If `dist/` already contains a previous build, electron-builder overwrites
  it.

## Testing

- The plan adds no unit tests; the artefact itself is the test.
- `npm test` (99) must still pass before `npm run dist` (no behaviour change).
- Verification is the end-to-end packaged-app check:
  1. `npm run dist` completes, `dist/LocalGold-<version>-arm64.dmg` exists,
     `dist/mac-arm64/LocalGold.app/` is a valid bundle.
  2. Open the dmg, drag LocalGold to Applications.
  3. Right-click → Open the first time; the app launches.
  4. Library shows existing cards (same `~/Documents/LocalGold`).
  5. Capture a card, save.
  6. ⌘+Enter on a query streams a Gemma answer with citations.
  7. 📸 Screenshot opens the macOS selector; annotation modal works.
  8. 🎙 Record produces a transcript.
  9. Settings → Choose folder works; Quit + reopen reads the new folder.
- The full `npm test` suite continues to pass at 99/99.
