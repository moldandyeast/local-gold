# LocalGold Phase 4 — Visual Refresh — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Builds on:** Phases 1–3 (capture, hybrid search, synthesized answers — shipped on `main`)

## Overview

Phase 4 gives LocalGold a real visual identity: a dark, minimal design system
with sharp 1px corners, the Onest typeface, and a six-colour accent palette
where every accent signals meaning. It is a **renderer-only refresh** — no
behaviour, IPC, storage, or main-process code changes.

## Goals

- Apply the agreed design system consistently across every renderer view.
- Define the system once, as CSS custom properties — no scattered hex values.
- Keep the app fully offline: the font is bundled, not loaded from a CDN.

## Non-Goals

- Any behaviour change — capture, search, ask mode, IPC are untouched.
- New views, layout restructuring, or features.
- Animation beyond what already exists (the citation `flash`).

## Design System

### Tokens

Defined once in `:root` in `styles.css`; every rule references them.

| Token         | Value     | Use                                         |
|---------------|-----------|---------------------------------------------|
| `--bg`        | `#1B1B1B` | App background                              |
| `--card`      | `#161616` | Cards, inputs, panels (recede from bg)      |
| `--fg`        | `#F3F3F3` | Primary text                                |
| `--fg-muted`  | `#5D5C5C` | Timestamps, secondary text, placeholders    |
| `--border`    | `#2a2a2a` | 1px edges on cards, inputs, panels          |
| `--primary`   | `#A27FED` | Purple — interactive                        |
| `--answer`    | `#F2B151` | Orange — answer                             |
| `--citation`  | `#82C7F5` | Blue — citations                            |
| `--match`     | `#D175AC` | Rose — keyword match                        |
| `--ok`        | `#90E9A2` | Green — healthy / success                   |
| `--problem`   | `#EC9494` | Red — offline / error                       |
| `--radius`    | `1px`     | Corner radius everywhere                    |

`--border` is a derived value (not in the original list) — a low-contrast edge
between `--bg` and `--card`, needed for 1px card and input borders.

### Accent roles

Accents signal meaning; nothing is decorative. Tags render in neutral grey.

| Accent          | Role                                                       |
|-----------------|------------------------------------------------------------|
| Purple `--primary`  | Active tab, input focus border, "Save card" button, links |
| Orange `--answer`   | Answer panel heading and the streaming caret           |
| Blue `--citation`   | `[n]` citation markers and the Sources list            |
| Rose `--match`      | Keyword-match highlight (`<mark>`) in result snippets  |
| Green `--ok`        | Healthy Ollama status, the "Saved." confirmation       |
| Red `--problem`     | Offline / model-missing status, answer error notes     |

### Typography

**Onest**, bundled locally via the `@fontsource-variable/onest` npm package.
The renderer imports the package's CSS; electron-vite/Vite bundles the
`.woff2` into the build output, so the font ships inside the app — no CDN.
LocalGold is local-first and must render correctly offline. `body` sets
`font-family: 'Onest Variable', -apple-system, system-ui, sans-serif` (the
system fonts remain only as a fallback if the font fails to load).

### Corners

`border-radius: var(--radius)` (1px) on every card, input, button, panel, and
tag — a near-square, sharp aesthetic.

## Application by Component

All changes are in `src/renderer/`. Class names and a few elements may be added
where the current markup has nothing to hook styles onto; no logic changes.

- **Shell** (`index.html`, `main.ts`, `styles.css`) — `main.ts` imports the
  `@fontsource-variable/onest` CSS; `--bg` body in Onest; the tab bar reads as
  muted text, the active tab in `--primary`.
- **Capture** (`capture.ts`, `styles.css`) — `--card` textarea and tag input
  with 1px `--border` edges and a `--primary` focus border; a `--primary`
  "Save card" button; the status line shows "Saved." in `--ok`.
- **Library** (`library.ts`, `styles.css`) — search input styled like the
  capture inputs; the Ollama status line in `--ok` when healthy and
  `--problem` when offline/model-missing; result cards on `--card` with 1px
  borders; tags in neutral grey; the keyword `<mark>` highlight in `--match`.
- **Answer panel** (`library.ts`, `styles.css`) — `--card` background; the
  "Answer" heading and streaming caret in `--answer`; `[n]` markers and the
  Sources list in `--citation`; the error note in `--problem`.

The citation `flash` animation keeps its behaviour; its colour shifts to a
brief `--primary` tint to fit the palette.

## Testing

This is a visual change; the renderer has no unit tests and none are added.
Verification is the existing `npm run dev` GUI pass, checking each surface
against the system:

- Shell and tab switching — background, font, active-tab colour.
- Capture — input focus ring, Save button, green "Saved.".
- Library — search input, result cards, grey tags, rose keyword highlight,
  green vs red status line.
- Answer — orange heading, streaming caret, blue citations, red error note
  (with Ollama stopped).

The full `npm test` suite must still pass unchanged — proof that no
behaviour was touched.
