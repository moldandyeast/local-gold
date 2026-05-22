# LocalGold Phase 4 — Visual Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a dark, minimal design system — `#1B1B1B` background, `#161616` cards, Onest, 1px corners, a six-colour role-based accent palette — across the LocalGold renderer.

**Architecture:** Renderer-only. The design system lives as CSS custom properties in `styles.css`; the Onest font is bundled via `@fontsource-variable/onest`. Two small renderer logic tweaks colour state-dependent text (the "Saved." confirmation and the Ollama status line). No main-process, IPC, storage, or behaviour changes.

**Tech Stack:** Electron, electron-vite, TypeScript, CSS custom properties, `@fontsource-variable/onest`.

---

## File Structure

```
src/
  renderer/
    env.d.ts       — CREATE: vite/client type reference (enables CSS imports)
    main.ts        — MODIFY: import the Onest font CSS
    styles.css     — REWRITE: token-based design system
    capture.ts     — MODIFY: green "Saved." confirmation
    library.ts     — MODIFY: status-line + answer-error colours
package.json       — MODIFY: add @fontsource-variable/onest
```

No test files: this is a visual change and the renderer has no unit tests.
The existing `npm test` suite must keep passing unchanged — proof that no
behaviour was touched.

**Note on `better-sqlite3` ABI:** run `npm rebuild better-sqlite3` before
`npm test`, and `npm run rebuild` before `npm run dev` (same as Phases 1–3).

---

## Task 1: Bundle the Onest font

**Files:**
- Create: `src/renderer/env.d.ts`
- Modify: `src/renderer/main.ts`, `package.json` (via npm)

- [ ] **Step 1: Install the font package**

Run: `npm install @fontsource-variable/onest`
Expected: the package is added to `dependencies`.

- [ ] **Step 2: Create `src/renderer/env.d.ts`**

This makes TypeScript accept `.css` imports in the renderer.

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 3: Import the font in `src/renderer/main.ts`**

Add this as the very first line of `src/renderer/main.ts`, above the existing
imports:

```ts
import '@fontsource-variable/onest/index.css';
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify it builds**

Run: `npm run build`
Expected: the build completes; the bundled output includes the Onest
`.woff2` file(s).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/env.d.ts src/renderer/main.ts
git commit -m "feat: bundle Onest font via @fontsource-variable/onest"
```

---

## Task 2: Design-system stylesheet

**Files:**
- Rewrite: `src/renderer/styles.css`

- [ ] **Step 1: Replace the entire contents of `src/renderer/styles.css`**

```css
:root {
  --bg: #1B1B1B;
  --card: #161616;
  --fg: #F3F3F3;
  --fg-muted: #5D5C5C;
  --border: #2A2A2A;
  --primary: #A27FED;
  --answer: #F2B151;
  --citation: #82C7F5;
  --match: #D175AC;
  --ok: #90E9A2;
  --problem: #EC9494;
  --radius: 1px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: 'Onest Variable', -apple-system, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

h2 { font-size: 16px; font-weight: 600; margin: 0 0 14px; }

/* Tab bar */
#tabs {
  display: flex;
  gap: 4px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
#tabs button {
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius);
}
#tabs button:hover { color: var(--fg); }
#tabs button.active { color: var(--primary); }

#view { padding: 18px; }

/* Inputs */
textarea,
input[type='text'] {
  width: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--fg);
  font: inherit;
  padding: 10px 11px;
}
textarea { min-height: 140px; resize: vertical; }
input[type='text'] { margin-top: 8px; }
textarea:focus,
input[type='text']:focus {
  outline: none;
  border-color: var(--primary);
}
::placeholder { color: var(--fg-muted); }

/* Buttons */
.primary {
  margin-top: 10px;
  padding: 8px 16px;
  background: var(--primary);
  color: var(--bg);
  border: 0;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

/* Text states */
.hint { color: var(--fg-muted); font-size: 12px; }
.ok { color: var(--ok); font-size: 12px; }
.problem { color: var(--problem); font-size: 12px; }
#ollama-status { font-size: 12px; margin: 10px 2px 14px; }

/* Cards */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 8px;
}
.card .meta { color: var(--fg-muted); font-size: 11px; }
.card .tag {
  display: inline-block;
  background: #232323;
  color: var(--fg-muted);
  border-radius: var(--radius);
  padding: 1px 7px;
  margin-right: 5px;
  font-size: 11px;
}
.card mark { background: transparent; color: var(--match); font-weight: 600; }
.card.flash { animation: flash 1s ease-out; }
@keyframes flash {
  from { background: color-mix(in srgb, var(--primary) 35%, var(--card)); }
  to { background: var(--card); }
}

.thumbs { margin-top: 8px; }
.thumbs img {
  max-width: 80px;
  max-height: 60px;
  margin-right: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

/* Answer panel */
#answer:not(:empty) {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  margin: 10px 0 14px;
}
#answer h3 {
  margin: 0 0 8px;
  color: var(--answer);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
#answer h4 {
  margin: 14px 0 4px;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.answer-text { white-space: pre-wrap; }
.answer-text.generating::after { content: ' ▍'; color: var(--answer); }
.cite { color: var(--citation); cursor: pointer; text-decoration: none; }
.sources { margin: 0; padding-left: 0; list-style: none; }
.sources li { margin: 3px 0; color: var(--fg-muted); font-size: 12px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles.css
git commit -m "feat: apply dark design-system stylesheet"
```

---

## Task 3: Capture — green "Saved." confirmation

**Files:**
- Modify: `src/renderer/capture.ts`

- [ ] **Step 1: Colour the status text by state**

In `src/renderer/capture.ts`, find the save-button click handler. Replace the
empty-body branch:

```ts
    if (!text) {
      status.textContent = 'Nothing to save.';
      return;
    }
```

with:

```ts
    if (!text) {
      status.textContent = 'Nothing to save.';
      status.className = 'hint';
      return;
    }
```

And replace the success line:

```ts
    status.textContent = 'Saved.';
```

with:

```ts
    status.textContent = 'Saved.';
    status.className = 'ok';
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/capture.ts
git commit -m "feat: show Saved confirmation in green"
```

---

## Task 4: Library — status and answer-error colours

**Files:**
- Modify: `src/renderer/library.ts`

- [ ] **Step 1: Colour the Ollama status line**

In `src/renderer/library.ts`, replace the `showStatus` function body:

```ts
  async function showStatus(): Promise<void> {
    const status = await window.localgold.ollamaStatus();
    if (status.reachable && status.hasEmbedModel) {
      statusEl.textContent = 'Semantic search on';
    } else if (status.reachable) {
      statusEl.textContent = 'Semantic search off — run: ollama pull embeddinggemma';
    } else {
      statusEl.textContent = 'Semantic search offline — start Ollama';
    }
  }
```

with:

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

- [ ] **Step 2: Colour the answer error note red**

In `src/renderer/library.ts`, in the ⌘+Enter `keydown` handler's `catch`
block, replace the error-note line:

```ts
      textEl.innerHTML =
        escapeHtml(raw) +
        `<p class="hint">Answer unavailable — ${escapeHtml(errorHint(message))}</p>`;
```

with:

```ts
      textEl.innerHTML =
        escapeHtml(raw) +
        `<p class="problem">Answer unavailable — ${escapeHtml(errorHint(message))}</p>`;
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/library.ts
git commit -m "feat: colour status line and answer errors by state"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no behaviour changed — full test suite**

Run: `npm rebuild better-sqlite3 && npm test`
Expected: PASS — all 65 tests, unchanged.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Visual pass in the running app**

Run: `npm run rebuild && npm run dev`

Check each surface against the design system:
- **Shell** — `#1B1B1B` background, Onest font, the active tab in purple.
- **Capture** — `#161616` inputs with 1px borders and a purple focus border;
  a purple "Save card" button; "Saved." appears in green.
- **Library** — purple-focus search input; result cards on `#161616` with 1px
  borders; tags in neutral grey; a keyword match highlighted in rose; the
  status line green when Ollama is healthy.
- **Answer** — orange "ANSWER" heading and streaming caret; blue `[n]`
  citations and Sources; clicking a citation flashes the card.
- **Errors** — with Ollama stopped, the status line is red and ⌘+Enter shows
  the answer-unavailable note in red.

Close the app.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: Phase 4 complete — visual refresh" --allow-empty
```

---

## Phase 4 Done

LocalGold wears a coherent dark, minimal design system: `#1B1B1B`/`#161616`
surfaces, Onest, 1px corners, and a six-colour accent palette where every
colour signals meaning. No behaviour changed — the full test suite passes
unchanged.
