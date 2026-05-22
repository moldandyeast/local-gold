# LocalGold Phase 3 — Synthesized Answers — Design

**Date:** 2026-05-22
**Status:** Approved for planning
**Builds on:** Phase 2 (hybrid keyword + semantic search, shipped on `main`)

## Overview

Phase 3 turns LocalGold from a search tool into a question-answering tool. The
live search box is unchanged; pressing **⌘+Enter** sends the current query to
Gemma 4 (via Ollama), which synthesizes an answer grounded in the user's own
cards and cites them inline. The answer streams token-by-token into a panel
above the card list. Everything stays local.

## Goals

- **One-keypress answers** — ⌘+Enter on any query produces a grounded answer.
- **Grounded and cited** — the answer is built only from the user's top cards
  and cites them inline as `[n]`, traceable back to the source card.
- **Streaming** — tokens appear as Gemma generates them.
- **Never in the way** — live search, semantic search, and capture are
  unaffected; answers degrade gracefully when Gemma is unavailable.

## Non-Goals

- Multi-turn conversation / follow-up questions (single-shot only).
- Persisting answers (they are ephemeral — replaced by the next query/ask).
- A card-detail view (citations scroll to cards already shown in the list).
- Editing or model-management UI.

## Architecture

Phase 3 adds one module and a streaming method, and extends three files.

```
ipc ── answer ──┬─ search (hybridSearch, Phase 2)
                └─ Chatter ◄── ollama.chat
```

### New module

- **`src/main/answer.ts`** — RAG orchestration. Runs `hybridSearch`, keeps the
  top 8 cards, builds a grounded prompt numbering them `[1]`–`[8]`, and streams
  Gemma's answer through a `Chatter`. Depends on the `Chatter` interface, not on
  `ollama` directly, so prompt-building and orchestration are unit-testable
  with a fake.

### Extended

- **`src/main/ollama.ts`** — adds `chat(messages, onToken)`: calls
  `/api/chat` with `stream: true`, invoking `onToken` per chunk. `Ollama` now
  satisfies the `Chatter` interface too.
- **`src/main/ipc.ts`** — adds the streaming `answer:ask` channel.
- **`src/main/config.ts`** — adds `answerModel` (default `gemma4:e4b`).
- **`src/preload/index.ts`** — exposes `ask(query, onToken)`.
- **`src/renderer/library.ts`** — ⌘+Enter handler and the answer panel.

### The `Chatter` interface

```ts
/** A streaming chat model. `onToken` is called with each text chunk. */
export interface Chatter {
  chat(
    messages: { role: 'system' | 'user'; content: string }[],
    onToken: (chunk: string) => void
  ): Promise<void>;
}
```

`ollama.ts` provides the real implementation; tests inject a fake.

## Data Flow

1. The user types — live keyword + semantic search filters the card list
   (Phase 2, unchanged).
2. The user presses **⌘+Enter** — the renderer calls `ask(query, onToken)`.
3. `answer.ts` runs `hybridSearch(db, ollama, query)` and keeps the **top 8**
   results as context cards.
4. It builds the prompt (see below) and calls `chatter.chat(messages, onToken)`.
5. Gemma 4 streams tokens → `answer:token` IPC events → the answer panel fills
   in live, above the card list.
6. On completion the IPC call resolves with `{ answer, sources }` where
   `sources` is the 8 context cards in `[n]` order.

### Prompt

- **System message:** instruct the model to answer using only the numbered
  cards, cite supporting cards inline as `[n]`, and state plainly when the
  cards do not cover the question.
- **User message:** the 8 cards, each as `[n] <card body>`, followed by the
  user's question.

The exact wording is pinned in the implementation plan.

## Citations & UI

The 8 cards sent to Gemma are exactly the top 8 already rendered in the results
list below the answer panel. Therefore:

- A `[n]` marker in the answer text is rendered as a clickable element.
- A **Sources** list below the answer maps each `[n]` to its card.
- Clicking either **scrolls to and briefly highlights card `n`** in the
  existing results list. No card-detail view is introduced.

The answer panel sits **above** the card list, with an "Answer" heading and a
subtle generating state while streaming. It is ephemeral: starting a new search
or pressing ⌘+Enter again replaces it. Pressing ⌘+Enter with an empty query or
no results does nothing.

## IPC: streaming

`answer:ask` cannot use `ipcMain.handle` (single response). Instead:

- The renderer sends `answer:ask` with the query.
- The main process streams `answer:token` events as chunks arrive.
- It ends with `answer:done` (carrying `{ answer, sources }`) or
  `answer:error` (carrying a message).
- `preload` wraps this: `ask(query, onToken)` returns a `Promise` that resolves
  on `answer:done` and rejects on `answer:error`, forwarding chunks to
  `onToken`. One ask runs at a time (single-flight); a new ask supersedes the
  panel.

## Error Handling

- **Gemma model not pulled:** Ollama's `/api/chat` returns an error; the answer
  panel shows "Answer unavailable — run: `ollama pull gemma4:e4b`".
- **Ollama unreachable:** the panel shows "Answer unavailable — start Ollama".
- **Mid-stream failure:** the panel keeps whatever streamed and appends a short
  error note.
- **No results to answer from:** ⌘+Enter is a no-op.
- Search, semantic search, and capture are never affected by any of the above.

## Testing

- **`answer.ts` prompt builder** — pure unit test: 8 cards in → numbered `[1]`–
  `[8]`, system instruction present, question included.
- **`answer.ts` orchestration** — with a fake `Chatter` emitting scripted
  tokens: verifies `onToken` is called per chunk, the assembled answer, the
  returned sources, and that only the top 8 cards are used when more match.
- **`ollama.ts` `chat`** — against a mock HTTP server streaming an NDJSON
  `/api/chat` response: tokens are delivered in order; a non-200 throws.
- **Citation parsing** (renderer helper) — pure unit test: `[n]` extraction
  from answer text and mapping to source cards, including out-of-range markers.

All Phase 3 logic is testable with no running Ollama.
