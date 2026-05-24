# LocalGold Phase 11 — Geist Visual Refresh v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply LocalGold's `MY System v1.5` design tokens, the typography scale (incl. Commit Mono), Lucide icons across every renderer surface, and the role → surface mapping (primary=rose, accent=purple, info/success/warning/danger) — without touching any behaviour.

**Architecture:** Renderer-only. A new `icons.ts` re-exports raw Lucide SVGs via Vite's `?raw` import with a small `icon(name, size?)` helper. `styles.css` is rewritten around CSS custom properties and a typography utility class. Each renderer file gets icons inserted into its template literals and switches state classes (`hint`/`ok`/`warning`/`problem`) for in-progress vs error vs success colouring.

**Tech Stack:** Electron, TypeScript, electron-vite, `@fontsource-variable/onest` (existing), `@fontsource-variable/commit-mono` (new), `lucide-static` (new).

---

## File Structure

```
src/
  renderer/icons.ts       — CREATE: Lucide raw-SVG re-exports + icon() helper
  renderer/styles.css     — REWRITE: tokens + typography scale + role-mapped restyles
  renderer/main.ts        — MODIFY: import Commit Mono; tab icons via icon()
  renderer/index.html     — UNCHANGED
  renderer/capture.ts     — MODIFY: rewrite HTML template with icons + .t-micro labels; state-class swaps for warning/problem
  renderer/library.ts     — MODIFY: rewrite HTML + cardHtml + answerHtml with icons; ollama-status with dot + .t-micro
  renderer/settings.ts    — MODIFY: icons on Choose folder / Reveal buttons
  renderer/annotate.ts    — MODIFY: toolbar buttons with Lucide icons; status warning/problem classes
package.json              — MODIFY: add lucide-static, @fontsource-variable/commit-mono
```

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as prior phases).

---

## Task 1: Fonts, icons package, `icons.ts`

**Files:**
- Modify: `package.json` (via npm)
- Modify: `src/renderer/main.ts`
- Create: `src/renderer/icons.ts`

- [ ] **Step 1: Install both packages**

Run: `npm install lucide-static @fontsource-variable/commit-mono`
Expected: both packages added to `dependencies`.

If `@fontsource-variable/commit-mono` doesn't resolve, fall back to
`npm install @fontsource/commit-mono` (the non-variable family with 400/500/700);
the CSS in Task 2 references `'Commit Mono Variable'` first with the same
`Commit Mono` fallback string so either works.

- [ ] **Step 2: Import Commit Mono in the renderer entry**

In `src/renderer/main.ts`, change:

```ts
import '@fontsource-variable/onest/index.css';
```

to:

```ts
import '@fontsource-variable/onest/index.css';
import '@fontsource-variable/commit-mono/index.css';
```

(If the variable package isn't available, use `import '@fontsource/commit-mono/400.css';` etc. for 400/500.)

- [ ] **Step 3: Create `src/renderer/icons.ts`**

```ts
import pencilLine from 'lucide-static/icons/pencil-line.svg?raw';
import libraryBig from 'lucide-static/icons/library-big.svg?raw';
import settingsIcon from 'lucide-static/icons/settings.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import cornerDownLeft from 'lucide-static/icons/corner-down-left.svg?raw';
import calendar from 'lucide-static/icons/calendar.svg?raw';
import play from 'lucide-static/icons/play.svg?raw';
import volume2 from 'lucide-static/icons/volume-2.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import image from 'lucide-static/icons/image.svg?raw';
import camera from 'lucide-static/icons/camera.svg?raw';
import mic from 'lucide-static/icons/mic.svg?raw';
import circleStop from 'lucide-static/icons/circle-stop.svg?raw';
import link from 'lucide-static/icons/link.svg?raw';
import tag from 'lucide-static/icons/tag.svg?raw';
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import externalLink from 'lucide-static/icons/external-link.svg?raw';
import penTool from 'lucide-static/icons/pen-tool.svg?raw';
import moveRight from 'lucide-static/icons/move-right.svg?raw';
import square from 'lucide-static/icons/square.svg?raw';
import undo2 from 'lucide-static/icons/undo-2.svg?raw';

const ICONS = {
  'pencil-line': pencilLine,
  'library-big': libraryBig,
  settings: settingsIcon,
  search,
  'corner-down-left': cornerDownLeft,
  calendar,
  play,
  'volume-2': volume2,
  sparkles,
  image,
  camera,
  mic,
  'circle-stop': circleStop,
  link,
  tag,
  'loader-circle': loaderCircle,
  'folder-open': folderOpen,
  'external-link': externalLink,
  'pen-tool': penTool,
  'move-right': moveRight,
  square,
  'undo-2': undo2
} as const;

export type IconName = keyof typeof ICONS;

/** Inline SVG, sized to `size` px, stroke inherits via currentColor. */
export function icon(name: IconName, size = 14): string {
  return ICONS[name]
    .replace(/width="\d+"/, `width="${size}"`)
    .replace(/height="\d+"/, `height="${size}"`);
}
```

- [ ] **Step 4: Verify it type-checks and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; the build output lists the bundled Commit Mono `.woff2` and Lucide assets.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer/main.ts src/renderer/icons.ts
git commit -m "feat: add Commit Mono font and Lucide icons module"
```

---

## Task 2: Rewrite `styles.css` around the token system

**Files:**
- Rewrite: `src/renderer/styles.css`

- [ ] **Step 1: Replace the entire contents of `src/renderer/styles.css`**

```css
:root {
  /* MY System v1.5 — dark mode */
  --bg: #1B1B1B;
  --card: #161616;
  --fg: #F3F3F3;
  --fg-muted: #5D5C5C;
  --border: #2A2A2A;
  --primary: #D175AC;  /* rose — interactive */
  --accent:  #A27FED;  /* purple — AI emphasis */
  --info:    #82C7F5;  /* blue — citations */
  --success: #90E9A2;  /* green — healthy */
  --warning: #F2B151;  /* orange — in-progress */
  --danger:  #EC9494;  /* red — error/offline */
  --radius: 1px;
  --pill:   9999px;
  --sans: 'Onest Variable', -apple-system, system-ui, sans-serif;
  --mono: 'Commit Mono Variable', 'Commit Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
}

/* Typography scale (element defaults + utility classes) */
h1, .t-h1 { font: 400 32px/1.10 var(--sans); letter-spacing: -0.015em; margin: 0 0 14px; }
h2, .t-h2 { font: 500 22px/1.20 var(--sans); letter-spacing: -0.010em; margin: 0 0 14px; }
h3, .t-h3 { font: 500 16px/1.30 var(--sans); margin: 0 0 6px; }
.t-body-lg { font: 400 17px/1.55 var(--sans); }
.t-body    { font: 400 14px/1.55 var(--sans); }
.t-caption { font: 400 12px/1.50 var(--sans); }
.t-micro {
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Tab bar */
#tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
#tabs button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border: 0; background: transparent;
  color: var(--fg-muted);
  font: 500 13px/1 var(--sans);
  cursor: pointer;
  border-radius: var(--radius);
}
#tabs button svg { vertical-align: -2px; }
#tabs button:hover { color: var(--fg); }
#tabs button.active {
  color: var(--primary);
  box-shadow: inset 0 -2px 0 var(--primary);
}

#view { padding: 18px; }

/* Inputs */
textarea, input[type='text'] {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg);
  font: 400 14px/1.4 var(--sans);
  padding: 9px 11px;
  outline: none;
}
textarea { min-height: 120px; resize: vertical; line-height: 1.55; }
textarea:focus, input[type='text']:focus { border-color: var(--primary); }
::placeholder { color: var(--fg-muted); }

/* Field labels (above inputs in Capture) */
.label {
  display: flex; align-items: center; gap: 5px;
  color: var(--fg-muted);
  margin-bottom: 6px;
}

/* Buttons */
.primary, .secondary {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px;
  border-radius: var(--radius);
  font: 500 13px/1 var(--sans);
  cursor: pointer;
}
.primary { background: var(--primary); color: var(--bg); border: 0; }
.secondary {
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid var(--border);
}
.secondary:hover { color: var(--fg); border-color: var(--fg-muted); }
.secondary.record.recording { color: var(--danger); border-color: var(--danger); }

/* State colours for status text spans */
.hint    { color: var(--fg-muted); }
.ok      { color: var(--success); }
.warning { color: var(--warning); }
.problem { color: var(--danger); }
.info    { color: var(--info); }

/* Capture status / timer typography (id-targeted so JS only swaps state colour class) */
#status, #enrich-status, #record-timer {
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Rows + checkbox row */
.row { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.check {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--fg-muted);
  margin-top: 8px;
}

/* Thumbnails + audio chip */
.thumbs {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  margin-top: 10px;
}
.thumbs img {
  max-width: 80px; max-height: 60px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.audio-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--pill);
  padding: 3px 10px;
  color: var(--fg-muted);
  font: 500 11px/1 var(--mono);
  letter-spacing: 0.04em;
}

/* Library: search input row */
.search-row {
  display: flex; align-items: center; gap: 12px;
  margin: 0 0 8px;
}
.search {
  position: relative;
  margin: 0 0 14px;
}
.search .ico {
  position: absolute; left: 11px; top: 50%; transform: translateY(-50%);
  color: var(--fg-muted); pointer-events: none;
}
.search input[type='text'] {
  margin-top: 0;
  padding-left: 34px;
}
.kbhint {
  margin-left: auto;
  color: var(--fg-muted);
  font: 500 11px/1 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 5px;
}

/* Library: ollama status pill (dot + mono label) */
#ollama-status {
  display: inline-flex; align-items: center; gap: 6px;
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
#ollama-status .dot {
  width: 6px; height: 6px;
  border-radius: var(--pill);
  background: currentColor;
}

/* Library cards: row style, no boxes */
#results > .card {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
  margin: 0;
}
.card .meta {
  display: flex; align-items: center; gap: 6px;
  color: var(--fg-muted);
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.card .body {
  font: 400 14px/1.55 var(--sans);
  margin: 4px 0 6px;
}
.card .tags {
  display: flex; align-items: center; gap: 14px;
}
.card .tag {
  background: transparent;
  color: var(--fg-muted);
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0;
  margin: 0;
}
.card mark {
  background: transparent;
  color: var(--accent);
  font-weight: 500;
}
.card.flash { animation: flash 1s ease-out; }
@keyframes flash {
  from { background: color-mix(in srgb, var(--primary) 25%, transparent); }
  to { background: transparent; }
}

.audios { display: inline-flex; gap: 6px; margin-left: auto; }
.play {
  display: inline-flex; align-items: center; gap: 5px;
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--border);
  border-radius: var(--pill);
  padding: 3px 10px 3px 8px;
  font: 500 11px/1 var(--sans);
  cursor: pointer;
}
.play:hover { border-color: var(--primary); }

/* Answer panel */
#answer:not(:empty) {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin: 10px 0 16px;
}
#answer h3 {
  display: inline-flex; align-items: center; gap: 6px;
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 8px;
}
#answer h4 {
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
  margin: 14px 0 4px;
}
.answer-text {
  font: 400 17px/1.55 var(--sans);
  white-space: pre-wrap;
}
.answer-text.generating::after { content: ' ▍'; color: var(--accent); }
.cite {
  color: var(--info);
  cursor: pointer;
  text-decoration: none;
  border-bottom: 1px dashed transparent;
}
.cite:hover { border-bottom-color: var(--info); }
.sources {
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--border);
  list-style: none;
  display: flex; flex-direction: column; gap: 4px;
}
.sources li {
  font: 500 11px/1.40 var(--mono);
  letter-spacing: 0.04em;
  color: var(--fg-muted);
  text-transform: none;
}
.sources .cite { color: var(--info); }

/* Settings */
.setting {
  margin-bottom: 22px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
}
.setting:last-child { border-bottom: 0; padding-bottom: 0; }
.setting h3 { margin: 0 0 8px; }
.path {
  font: 500 12px/1.4 var(--mono);
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 12px;
  margin: 0 0 12px;
}
#fallback:empty { display: none; }
#pending:empty { display: none; }
#pending code { font-family: var(--mono); }

/* Annotation modal */
.annot-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 10, 10, 0.92);
  z-index: 1000;
  display: flex;
  flex-direction: column;
}
.annot-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.annot-toolbar .spacer { flex: 1; }
.annot-toolbar .tool {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font: 500 11px/1 var(--mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}
.annot-toolbar .tool.active {
  color: var(--primary);
  border-color: var(--primary);
}
.annot-canvas-wrap {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
#annot-canvas {
  max-width: 100%;
  max-height: 100%;
  background: #fff;
  border: 1px solid var(--border);
  cursor: crosshair;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat: apply MY System v1.5 design tokens + typography scale"
```

---

## Task 3: Tabs with icons

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: Add icon population to `main.ts`**

In `src/renderer/main.ts`, change the import block to include `icon`:

```ts
import { renderCapture } from './capture';
import { renderLibrary } from './library';
import { renderSettings } from './settings';
```

to:

```ts
import { renderCapture } from './capture';
import { renderLibrary } from './library';
import { renderSettings } from './settings';
import { icon } from './icons';
```

Then, after the `const tabSettings = ...` line and before `function selectTab`, add:

```ts
tabCapture.innerHTML = `${icon('pencil-line', 14)} Capture`;
tabLibrary.innerHTML = `${icon('library-big', 14)} Library`;
tabSettings.innerHTML = `${icon('settings', 14)} Settings`;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/main.ts
git commit -m "feat: add icons to tab buttons"
```

---

## Task 4: Capture view — icons, labels, state-colour status

**Files:**
- Modify: `src/renderer/capture.ts`

- [ ] **Step 1: Add the icons import**

In `src/renderer/capture.ts`, add this import after the existing imports:

```ts
import { icon } from './icons';
```

- [ ] **Step 2: Replace the `host.innerHTML` template**

Replace the template literal that begins `host.innerHTML = \`` (the one containing `<h2>Capture</h2>`) with:

```ts
  host.innerHTML = `
    <h2>Capture</h2>
    <div>
      <div class="label t-micro">Note</div>
      <textarea id="body" placeholder="Write an insight…"></textarea>
    </div>
    <div style="margin-top:14px">
      <div class="label t-micro">${icon('tag', 11)} Tags</div>
      <input id="tags" type="text" placeholder="pricing, strategy" />
    </div>
    <div style="margin-top:14px">
      <div class="label t-micro">${icon('link', 11)} Link</div>
      <input id="url" type="text" placeholder="https://…" />
      <label class="check t-micro" for="enrich-url">
        <input type="checkbox" id="enrich-url" /> Summarise the linked page
      </label>
    </div>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <button class="secondary" id="pick">${icon('image', 12)} Choose images</button>
      <button class="secondary" id="screenshot">${icon('camera', 12)} Screenshot</button>
      <button class="secondary record" id="record">${icon('mic', 12)} Record</button>
      <span id="record-timer" class="hint"></span>
    </div>
    <div class="row">
      <button class="primary" id="save">Save card</button>
      <span id="status" class="hint"></span>
    </div>
    <div id="enrich-status" class="hint" style="margin-top:8px"></div>
  `;
```

- [ ] **Step 3: Swap state classes to `warning` during in-progress, `problem` on failure**

In `src/renderer/capture.ts`, find these lines and add the `className = 'warning'` / `'problem'` swaps:

Replace:

```ts
    enrichStatus.textContent = 'Describing image…';
    void window.localgold.enrichImage(data).then((enr) => {
      applyEnrichment('Image', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
```

with:

```ts
    enrichStatus.textContent = 'Describing image…';
    enrichStatus.className = 'warning';
    void window.localgold.enrichImage(data).then((enr) => {
      applyEnrichment('Image', enr);
      if (enr.description) {
        enrichStatus.textContent = '';
        enrichStatus.className = 'hint';
      } else {
        enrichStatus.textContent = 'Enrichment unavailable.';
        enrichStatus.className = 'problem';
      }
    });
```

Replace:

```ts
    enrichStatus.textContent = 'Reading the page…';
    void window.localgold.enrichUrl(value).then((enr) => {
      applyEnrichment('Link', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
```

with:

```ts
    enrichStatus.textContent = 'Reading the page…';
    enrichStatus.className = 'warning';
    void window.localgold.enrichUrl(value).then((enr) => {
      applyEnrichment('Link', enr);
      if (enr.description) {
        enrichStatus.textContent = '';
        enrichStatus.className = 'hint';
      } else {
        enrichStatus.textContent = 'Enrichment unavailable.';
        enrichStatus.className = 'problem';
      }
    });
```

In `processRecording`, replace:

```ts
    enrichStatus.textContent = 'Transcribing voice…';
    let transcript = '';
    try {
      const samples = await decodeToPCM16k(blob);
      transcript = await window.localgold.transcribe(samples, 16000);
    } catch {
      transcript = '';
    }
    if (!transcript) {
      enrichStatus.textContent = 'Transcription unavailable.';
      return;
    }
    const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
    body.value = `${prefix}## Voice\n${transcript}`;
    enrichStatus.textContent = 'Tagging transcript…';
    const enr = await window.localgold.enrichText(transcript);
    mergeTags(enr.tags);
    enrichStatus.textContent = '';
```

with:

```ts
    enrichStatus.textContent = 'Transcribing voice…';
    enrichStatus.className = 'warning';
    let transcript = '';
    try {
      const samples = await decodeToPCM16k(blob);
      transcript = await window.localgold.transcribe(samples, 16000);
    } catch {
      transcript = '';
    }
    if (!transcript) {
      enrichStatus.textContent = 'Transcription unavailable.';
      enrichStatus.className = 'problem';
      return;
    }
    const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
    body.value = `${prefix}## Voice\n${transcript}`;
    enrichStatus.textContent = 'Tagging transcript…';
    enrichStatus.className = 'warning';
    const enr = await window.localgold.enrichText(transcript);
    mergeTags(enr.tags);
    enrichStatus.textContent = '';
    enrichStatus.className = 'hint';
```

In `startRecording`, replace:

```ts
    } catch {
      enrichStatus.textContent = 'Microphone unavailable.';
      return;
    }
```

with:

```ts
    } catch {
      enrichStatus.textContent = 'Microphone unavailable.';
      enrichStatus.className = 'problem';
      return;
    }
```

In Save handler, replace the final reset block:

```ts
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
```

with:

```ts
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    enrichStatus.className = 'hint';
    status.textContent = 'Saved.';
    status.className = 'ok';
```

- [ ] **Step 4: Replace `addAudioChip` to use the mic icon**

Replace:

```ts
  function addAudioChip(name: string): void {
    const chip = document.createElement('span');
    chip.className = 'audio-chip';
    chip.textContent = `🎙 ${name}`;
    thumbs.appendChild(chip);
  }
```

with:

```ts
  function addAudioChip(name: string): void {
    const chip = document.createElement('span');
    chip.className = 'audio-chip';
    chip.innerHTML = icon('mic', 10);
    chip.appendChild(document.createTextNode(' ' + name));
    thumbs.appendChild(chip);
  }
```

- [ ] **Step 5: Swap the Record button label icons**

In `startRecording`, replace:

```ts
    recordBtn.textContent = '⏹ Stop';
```

with:

```ts
    recordBtn.innerHTML = `${icon('circle-stop', 12)} Stop`;
```

In `stopRecording`, replace:

```ts
    recordBtn.textContent = '🎙 Record';
```

with:

```ts
    recordBtn.innerHTML = `${icon('mic', 12)} Record`;
```

- [ ] **Step 6: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/capture.ts
git commit -m "feat: capture view — icons, t-micro labels, warning/problem status"
```

---

## Task 5: Library view — icons everywhere, row-style cards

**Files:**
- Modify: `src/renderer/library.ts`

- [ ] **Step 1: Add the icons import**

In `src/renderer/library.ts`, add this import after the existing imports:

```ts
import { icon } from './icons';
```

- [ ] **Step 2: Rewrite `cardHtml`**

Replace the existing `cardHtml` function with:

```ts
function cardHtml(card: Card, snippet?: string): string {
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const text = snippet
    ? escapeHtml(snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')
    : escapeHtml(card.body.slice(0, 240));
  const audioRels = card.attachments.filter((a) => /\.(webm|m4a|mp3|wav|ogg)$/i.test(a));
  const imageCount = card.attachments.length - audioRels.length;
  const imageMeta = imageCount > 0 ? ` · ${imageCount} image${imageCount > 1 ? 's' : ''}` : '';
  const audios = audioRels
    .map(
      (a) =>
        `<button class="play" data-rel="${escapeHtml(a)}">${icon('play', 10)} Play</button>`
    )
    .join('');
  return `<div class="card" data-card-id="${escapeHtml(card.id)}">
    <div class="meta">${icon('calendar', 11)} ${escapeHtml(card.created)}${imageMeta}</div>
    <div class="body">${text}</div>
    <div class="tags">${tags}${audios ? `<div class="audios">${audios}</div>` : ''}</div>
  </div>`;
}
```

- [ ] **Step 3: Rewrite `answerHtml`**

Replace the existing `answerHtml` function with:

```ts
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
  return `<h3>${icon('sparkles', 11)} Answer</h3>
    <div class="answer-text">${body}</div>
    <h4>Sources</h4>
    <ul class="sources">${sources}</ul>`;
}
```

- [ ] **Step 4: Replace the `renderLibrary` HTML template + `showStatus`**

In `renderLibrary`, replace the `host.innerHTML = \`…\`` block with:

```ts
  host.innerHTML = `
    <h2>Library</h2>
    <div class="search-row">
      <div id="ollama-status"></div>
      <span class="kbhint">${icon('corner-down-left', 10)} ⌘↵ to ask</span>
    </div>
    <div class="search">
      <span class="ico">${icon('search', 14)}</span>
      <input id="q" type="text" placeholder="Search cards…" />
    </div>
    <div id="answer"></div>
    <div id="results"></div>
  `;
```

Replace `showStatus`:

```ts
  async function showStatus(): Promise<void> {
    const status = await window.localgold.ollamaStatus();
    const healthy = status.reachable && status.hasEmbedModel;
    if (healthy) {
      statusEl.textContent = 'Semantic search on';
    } else if (status.reachable) {
      statusEl.textContent = 'Semantic search off — run: ollama pull embeddinggemma';
    } else {
      statusEl.textContent = 'Semantic search offline — start Ollama';
    }
    statusEl.className = healthy ? 'ok' : 'problem';
  }
```

with:

```ts
  async function showStatus(): Promise<void> {
    const status = await window.localgold.ollamaStatus();
    const healthy = status.reachable && status.hasEmbedModel;
    let text: string;
    if (healthy) text = 'Semantic search on';
    else if (status.reachable) text = 'Semantic search off — run: ollama pull embeddinggemma';
    else text = 'Semantic search offline — start Ollama';
    statusEl.innerHTML = `<span class="dot"></span>${escapeHtml(text)}`;
    statusEl.className = healthy ? 'ok' : 'problem';
  }
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/library.ts
git commit -m "feat: library — search icon, dot status, row cards, sparkles answer"
```

---

## Task 6: Settings — icons on Choose folder / Reveal

**Files:**
- Modify: `src/renderer/settings.ts`

- [ ] **Step 1: Add the icons import**

In `src/renderer/settings.ts`, add this import after the existing import:

```ts
import { icon } from './icons';
```

- [ ] **Step 2: Replace the host template's two buttons**

In `renderSettings`, replace:

```ts
      <div class="row">
        <button class="secondary" id="pick-folder">Choose folder…</button>
        <button class="secondary" id="reveal">Reveal in Finder</button>
      </div>
```

with:

```ts
      <div class="row">
        <button class="secondary" id="pick-folder">${icon('folder-open', 12)} Choose folder…</button>
        <button class="secondary" id="reveal">${icon('external-link', 12)} Reveal in Finder</button>
      </div>
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/settings.ts
git commit -m "feat: settings — icons on folder buttons"
```

---

## Task 7: Annotate modal — toolbar icons + state-colour status

**Files:**
- Modify: `src/renderer/annotate.ts`

- [ ] **Step 1: Add the icons import**

In `src/renderer/annotate.ts`, add this import after the existing imports:

```ts
import { icon } from './icons';
```

- [ ] **Step 2: Replace the overlay's `innerHTML` template**

Find the block beginning `overlay.innerHTML = \`` and replace it with:

```ts
    overlay.innerHTML = `
      <div class="annot-toolbar">
        <button class="tool active" data-tool="pen">${icon('pen-tool', 11)} Pen</button>
        <button class="tool" data-tool="arrow">${icon('move-right', 11)} Arrow</button>
        <button class="tool" data-tool="rect">${icon('square', 11)} Rect</button>
        <button class="tool" id="undo">${icon('undo-2', 11)} Undo</button>
        <button class="tool" id="record">${icon('mic', 11)} Record</button>
        <span id="annot-status" class="hint t-micro"></span>
        <span class="spacer"></span>
        <button class="secondary" id="cancel">Cancel</button>
        <button class="primary" id="done">Done</button>
      </div>
      <div class="annot-canvas-wrap">
        <canvas id="annot-canvas"></canvas>
      </div>
    `;
```

- [ ] **Step 3: Swap mic / stop icons on the in-modal record button**

Find the `recordBtn.addEventListener('click', async () => {` block. Replace
`recordBtn.textContent = '🎙 Re-record';` with:

```ts
        recordBtn.innerHTML = `${icon('mic', 11)} Re-record`;
```

Replace `recordBtn.textContent = '⏹ Stop';` with:

```ts
      recordBtn.innerHTML = `${icon('circle-stop', 11)} Stop`;
```

- [ ] **Step 4: Swap state classes on `statusEl`**

In the same `recordBtn` handler, update the status lines.

Replace:

```ts
      } catch {
        statusEl.textContent = 'Microphone unavailable.';
        return;
      }
```

with:

```ts
      } catch {
        statusEl.textContent = 'Microphone unavailable.';
        statusEl.className = 'problem t-micro';
        return;
      }
```

Replace:

```ts
        statusEl.textContent = 'Transcribing voice…';
        let transcript = '';
        try {
          const samples = await decodeToPCM16k(blob);
          transcript = await window.localgold.transcribe(samples, 16000);
        } catch {
          transcript = '';
        }
        if (!transcript) {
          voiceBody = '';
          voiceTags = [];
          statusEl.textContent = 'Transcription unavailable.';
          return;
        }
        voiceBody = transcript;
        statusEl.textContent = 'Tagging transcript…';
        const enr: Enrichment = await window.localgold.enrichText(transcript);
        voiceTags = enr.tags;
        statusEl.textContent = '';
```

with:

```ts
        statusEl.textContent = 'Transcribing voice…';
        statusEl.className = 'warning t-micro';
        let transcript = '';
        try {
          const samples = await decodeToPCM16k(blob);
          transcript = await window.localgold.transcribe(samples, 16000);
        } catch {
          transcript = '';
        }
        if (!transcript) {
          voiceBody = '';
          voiceTags = [];
          statusEl.textContent = 'Transcription unavailable.';
          statusEl.className = 'problem t-micro';
          return;
        }
        voiceBody = transcript;
        statusEl.textContent = 'Tagging transcript…';
        statusEl.className = 'warning t-micro';
        const enr: Enrichment = await window.localgold.enrichText(transcript);
        voiceTags = enr.tags;
        statusEl.textContent = '';
        statusEl.className = 'hint t-micro';
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/annotate.ts
git commit -m "feat: annotate — toolbar icons + warning/problem status"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — every test, all 99, unchanged.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual / behaviour pass in the running app**

Run: `npm run rebuild && npm run dev`

Check each surface against the spec:

- **Shell** — body `--bg`; Onest body; tabs each show a Lucide icon + label;
  the active tab is rose with a 2px rose underline.
- **Capture** — labels in mono micro-caps with icons for Tags and Link;
  fields with `--card` bg + `--border` 1px, focus border rose; Save is a
  solid rose button; Choose images / Screenshot / Record secondary, each
  with its Lucide icon; "Saved." in green; on attach, status shows
  "Describing image…" in orange; on a URL with the checkbox ticked,
  "Reading the page…" in orange; on Record → "Transcribing voice…" then
  "Tagging transcript…" in orange.
- **Library** — leading magnifier icon in the search input; status dot
  (green / red) with the mono status label; cards as row-style with a
  calendar icon next to the timestamp, plain tag text, audio cards have a
  rose pill `▶ Play` button; the keyword match in `<mark>` is purple.
- **Answer panel** — purple `Answer` sparkles heading in mono micro-caps;
  body in 17px Onest; blue citations underlined dashed on hover; sources
  list in mono.
- **Settings** — sections separated by hairlines; the path in mono in a
  card-coloured box; folder + reveal buttons show Lucide icons.
- **Annotate modal** — toolbar buttons show icon + uppercase mono label;
  active tool flips to rose border + text; canvas centred with a hairline
  frame; record button swaps to a stop icon while recording.
- **Errors** — stop Ollama: status dot in red, status text in red; clicking
  ⌘+Enter shows the unavailable note in red.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 11 complete — Geist visual refresh v2" --allow-empty
```

---

## Phase 11 Done

LocalGold now wears the `MY System v1.5` tokens rigorously: rose is the
human's interactive colour, purple is the AI emphasis colour, blue marks
citations, orange marks work in progress, green is healthy, red is error.
Lucide icons appear at every meaningful surface; mono micro-caps in
Commit Mono give the UI rhythm. No behaviour changed; the test suite still
passes at 99/99.
