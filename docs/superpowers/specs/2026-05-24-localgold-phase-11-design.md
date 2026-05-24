# LocalGold Phase 11 — Geist Visual Refresh v2 — Design

**Date:** 2026-05-24
**Status:** Approved for planning
**Builds on:** Phase 4 (visual refresh v1) and every phase that came after — shipped on `main`

## Overview

Phase 11 is a rigorous renderer-only visual overhaul that adopts the user's
explicit design-token system and an icon-forward, Geist-flavoured aesthetic
across every surface. The codebase keeps its dark canvas and existing six-accent
palette, but tightens **every accent to a semantic role** (primary / accent /
info / success / warning / danger), applies a fully-defined **type scale**
including a new monospace track (Commit Mono), and adds **Lucide line icons**
at meaningful spots throughout the UI.

No behaviour, IPC, storage, or main-process code changes. The 99-test suite
must continue to pass — proof nothing functional moved.

## Goals

- Drive every colour, font, size and weight from named tokens; no raw hex or
  ad-hoc sizes in component CSS.
- Make the role of every accent unambiguous — primary is the user's
  interactive colour, accent is AI emphasis, info is citation, warning is
  in-progress, danger is error, success is healthy.
- Establish a clear typography rhythm with a mono "micro" label style as the
  visual rhythm element.
- Add icons where they add meaning (status, action, type-of-thing) without
  becoming decoration.

## Non-Goals

- Any behaviour change. The renderer's logic is preserved; only DOM templates
  and CSS change.
- New views or features. No new tabs, no new flows.
- Light mode. The user's tokens declare `modes: ["dark"]`; only dark.
- Replacing Onest. Onest stays; Commit Mono is added beside it.
- A component library or framework migration. Plain TS + CSS, as today.

## Design Tokens

All values live in `:root` as CSS custom properties; every rule references
them. From the user's `MY System v1.5`:

| Token | Value | Role |
|---|---|---|
| `--bg` | `#1B1B1B` | App background |
| `--card` | `#161616` | Cards, inputs, panels (recede from bg) |
| `--fg` | `#F3F3F3` | Primary text |
| `--fg-muted` | `#5D5C5C` | Secondary text, timestamps, placeholders |
| `--border` | `#2A2A2A` | 1px hairlines (derived) |
| `--primary` | `#D175AC` (rose) | Interactive: active tab, focus, primary button, links |
| `--accent` | `#A27FED` (purple) | AI emphasis: answer heading, streaming caret, keyword `<mark>` |
| `--info` | `#82C7F5` (blue) | `[n]` citations + Sources list |
| `--success` | `#90E9A2` (green) | Healthy status, "Saved." |
| `--warning` | `#F2B151` (orange) | In-progress status (transcribing, describing, reading…) |
| `--danger` | `#EC9494` (red) | Offline status, error notes |
| `--radius` | `1px` | Card / input / button corners |
| `--pill` | `9999px` | Audio chip, status dot, "Play" pill |

`--border` is a derived value (low-contrast edge between `--bg` and `--card`);
it is not in the spec JSON but is the system's edge colour.

## Typography

| Class | Size / line / track / weight | Font |
|---|---|---|
| `.t-h1` | 32 / 1.10 / −0.015em / 400 | Onest |
| `.t-h2` | 22 / 1.20 / −0.01em / 500 | Onest |
| `.t-h3` | 16 / 1.30 / 0 / 500 | Onest |
| `.t-body-lg` | 17 / 1.55 / 0 / 400 | Onest |
| `.t-body` | 14 / 1.55 / 0 / 400 | Onest |
| `.t-caption` | 12 / 1.50 / 0 / 400 | Onest |
| `.t-micro` | 11 / 1.40 / 0.04em / 500 / uppercase | **Commit Mono** |

Defaults: `body` is `.t-body`. `h1`/`h2`/`h3` map to the matching `t-h*` size
without needing the utility class. `.t-micro` is the label / status / source
rhythm element used everywhere a small mono-tracked uppercase label is wanted.

**Commit Mono** ships as `@fontsource-variable/commit-mono` (npm), imported
once from `src/renderer/main.ts` alongside the Onest import so Vite bundles
both `.woff2` files. Fallback stack:
`'Commit Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace`.

## Role → Surface mapping

| Surface | Role / colour |
|---|---|
| Tab bar active item | `--primary` (text colour + 2px underline) |
| Input focus border | `--primary` |
| Save button (Capture) | `--primary` solid bg, `--bg` text |
| Quit button (Settings) | `--primary` solid bg |
| Secondary buttons (Choose images / Screenshot / Record / Cancel / Reveal / Choose folder) | transparent, `--fg-muted` border + text, hover → `--fg` |
| Answer heading (`ANSWER`) + streaming caret | `--accent` |
| Keyword match `<mark>` | `--accent` |
| Citation `[n]` markers + Sources list `[n]` | `--info` |
| "Semantic search on", "Saved." | `--success` |
| "Transcribing voice…", "Describing image…", "Reading the page…", "Tagging transcript…" | `--warning` |
| "Semantic search offline", "Microphone unavailable", "Answer unavailable — …" | `--danger` |
| Card timestamps, tags, sources, labels, status text | `--fg-muted` in `.t-micro` |
| Annotate-modal active tool button | `--primary` border + text |
| Annotate-modal drawn shapes (already in code) | `--danger` (#EC9494, unchanged) |

The keyword `<mark>` moves from rose (Phase 4 `match`) to purple
(`accent`) so AI-derived emphasis reads as one thing and primary (rose) is
reserved for the human's interactive surfaces.

## Icons (Lucide, inline SVG)

A new `src/renderer/icons.ts` re-exports raw Lucide SVGs from
`lucide-static/icons/*.svg` using Vite's `?raw` import. It exports a single
helper:

```ts
export function icon(name: IconName, size = 14): string;
```

…which returns an SVG string with `width`/`height` set and
`stroke="currentColor"` so colour is inherited from the surrounding text. The
helper is used inside the renderer's existing `innerHTML` templates.

| Surface | Icon (Lucide name) |
|---|---|
| Tab: Capture | `pencil-line` |
| Tab: Library | `library-big` |
| Tab: Settings | `settings` |
| Library: search input (leading) | `search` |
| Library: ⌘↵ hint | `corner-down-left` |
| Library: status dot | `circle` (filled, sized to 6px) |
| Card: timestamp | `calendar` |
| Card: Play button | `play` (filled) |
| Card: audio present indicator | `volume-2` |
| Answer heading | `sparkles` |
| Capture: Choose images | `image` |
| Capture: Screenshot | `camera` |
| Capture: Record / Stop | `mic` / `circle-stop` |
| Capture: URL field (leading) | `link` |
| Capture: tags field (leading) | `tag` |
| Capture: in-progress spinner | `loader-circle` |
| Settings: Choose folder | `folder-open` |
| Settings: Reveal in Finder | `external-link` |
| Annotate toolbar: Pen | `pen-tool` |
| Annotate toolbar: Arrow | `move-right` |
| Annotate toolbar: Rectangle | `square` |
| Annotate toolbar: Undo | `undo-2` |
| Annotate toolbar: Record | `mic` (→ `circle-stop` when active) |

All icons are 14px in toolbars, 11px next to `.t-micro` labels, 10px in the
audio chip play button.

## Component-by-component restyle

All changes are renderer-only. Class names and a few small markup additions
(e.g. inserting icon spans, replacing some `<p class="hint">` with
`<span class="t-micro">`) — never logic changes.

### Shell (`index.html`, `main.ts`)
Body uses `--bg` and `.t-body`. Tabs render as icon + label, active in
`--primary` with a 2px `--primary` underline that sits flush with the tab-bar
bottom hairline.

### Capture (`capture.ts`)
- Each field gets a `.t-micro` label above it (Note / Tags / Link).
- Textarea and inputs `--card` bg with `--border` 1px edge, `--primary` focus.
- Secondary buttons (Choose images / Screenshot / Record) icon-left, `.t-body`.
- **Save** is the only primary button (rose solid).
- Status line `#status` colours: success on "Saved.", hint on "Nothing to save.".
- `#enrich-status` uses `--warning` for in-progress text (Phase 4 left it grey);
  the small loader icon spins via a CSS keyframe.
- Thumbs row: image thumbnails get a 1px `--border`; audio chip rendered as a
  `--pill`-radius `.t-micro` chip with a `mic` icon.

### Library (`library.ts`)
- Search input has a leading `search` icon and a trailing `⌘↵` hint (icon +
  text in `.t-micro`).
- `#ollama-status` rendered as: dot (`--success`/`--warning`/`--danger`) + text
  in `.t-micro`.
- Cards become row-style (no per-card border), separated by hairlines on the
  bottom. Within each row: meta line (`calendar` icon + `.t-micro` timestamp),
  body in `.t-body`, tags as plain `.t-micro` muted text (no chips).
- Audio attachments render as the existing `.play` button restyled to a
  `--pill` chip with `play` icon, `--primary` colour.
- Keyword `<mark>` uses `--accent` (purple) instead of rose.

### Answer panel (`library.ts answerHtml`)
- `--card` bg, 1px `--border`, no shadow.
- Heading row: `sparkles` icon + "ANSWER" in `.t-micro` + `--accent` colour.
- Body in `.t-body-lg` (17px) for prominence.
- `.cite` links in `--info`, dashed underline on hover.
- Sources list rendered as `.t-micro` rows separated by a small space, each
  `[n]` in `--info`.

### Settings (`settings.ts`)
- Each section divided by a hairline.
- Section title `.t-h3`.
- The data folder path rendered in a `--card` `path-box` with Commit Mono.
- Choose folder / Reveal in Finder as `.secondary` buttons with icons.
- The pending block's "Quit LocalGold" stays `--primary`.
- Fallback notice in `--danger`.

### Annotate modal (`annotate.ts`)
- Overlay unchanged in structure.
- Toolbar restyled: each tool is a `.t-micro`-labelled, icon-left button with
  `--border` edge; active tool flips to `--primary` border + text.
- Canvas centred on a hairline `--border` frame.
- `#annot-status` uses `--warning` for in-progress text.

### Affected files (renderer only)

```
src/renderer/styles.css        — REWRITE around tokens + typography scale + role mapping
src/renderer/icons.ts          — CREATE: Lucide raw-SVG re-exports + icon(name, size?) helper
src/renderer/main.ts           — MODIFY: import @fontsource-variable/commit-mono; tab icons in HTML
src/renderer/index.html        — MODIFY: nothing (icons go in via main.ts/tab buttons or inline in templates)
src/renderer/capture.ts        — MODIFY: add icons in template literals; .t-micro labels; status colour classes
src/renderer/library.ts        — MODIFY: icons; .t-micro labels; status dot; row-style cards; audio chip
src/renderer/settings.ts       — MODIFY: icons; .t-micro labels; section structure
src/renderer/annotate.ts       — MODIFY: toolbar icons + .t-micro labels
package.json                   — MODIFY: add lucide-static, @fontsource-variable/commit-mono
```

## Implementation guardrails

- **No JS logic changes.** Every JS file's change is one of: rewriting an HTML
  template string to insert icons / change classes, swapping a className for a
  state class (`hint` → `ok` etc., already a pattern), or adding the font
  import.
- **No new IPC, no new shared types.** Phase 11 touches only renderer files
  and `package.json`.
- **Selectors stay stable.** All IDs and structural classes referenced from
  JS (`#tabs`, `#tab-capture`, `#answer`, `.card`, `.cite`, `.sources`, `.play`,
  `.annot-*`, etc.) remain — the visual change goes through CSS + added child
  elements, not by reshaping the DOM tree the existing JS queries.
- **Test suite is the contract.** `npm test` must continue to pass at 99/99.

## Error handling

Pure visual change; no new error surfaces. The existing renderer error paths
just adopt the new colour roles (warning during in-progress, danger on
failure, success on healthy).

## Testing

- No new unit tests. The renderer continues to be GUI-verified.
- The full `npm test` suite must pass unchanged — this is the proof that no
  behaviour was touched.
- GUI pass:
  1. **Shell** — body `--bg`, Onest, tabs each show an icon + label, active
     tab in `--primary` with the underline.
  2. **Capture** — labels in mono micro caps; field focus is rose; Save is rose;
     Choose images / Screenshot / Record secondary with icons; "Saved." in
     green; "Transcribing voice…" / "Describing image…" / "Reading the page…"
     in orange.
  3. **Library** — leading search icon; status dot green / red; cards as rows
     separated by hairlines; keyword match in purple; audio cards show a Play
     pill in rose.
  4. **Answer** — purple "ANSWER" sparkles heading; body in 17px; blue
     citations underlined on hover; mono Sources list.
  5. **Settings** — sections with hairlines; mono path box; folder + reveal
     icons; section titles in `.t-h3`.
  6. **Annotate modal** — toolbar shows icon+label per tool; active tool in
     rose; the existing pen / arrow / rect / undo / record / done / cancel
     behaviours all work unchanged.
  7. With Ollama stopped — status dot red, "Semantic search offline" in red.
