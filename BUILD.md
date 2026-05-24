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
