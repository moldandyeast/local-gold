import type { AnswerResult, Card } from '../shared/types';
import { parseCitations } from './citations';

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

function cardHtml(card: Card, snippet?: string): string {
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  const text = snippet
    ? escapeHtml(snippet).replace(/«/g, '<mark>').replace(/»/g, '</mark>')
    : escapeHtml(card.body.slice(0, 240));
  const attach = card.attachments.length
    ? `<div class="meta">${card.attachments.length} image(s) attached</div>`
    : '';
  return `<div class="card" data-card-id="${escapeHtml(card.id)}">
    <div class="meta">${escapeHtml(card.created)}</div>
    <div>${text}</div>
    <div>${tags}</div>${attach}
  </div>`;
}

/** Render a finished answer: inline [n] links plus a Sources list. */
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
  return `<h3>Answer</h3><div class="answer-text">${body}</div>
    <h4>Sources</h4><ul class="sources">${sources}</ul>`;
}

/** Map a chat error message to a short fix hint. */
function errorHint(message: string): string {
  return /HTTP [45]/.test(message) ? 'run: ollama pull gemma4:e4b' : 'start Ollama';
}

/** Render the library / search view into `host`. */
export function renderLibrary(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Library</h2>
    <div id="ollama-status" class="hint"></div>
    <input id="q" type="text" placeholder="Search cards…  (⌘+Enter to ask)" />
    <div id="answer"></div>
    <div id="results"></div>
  `;
  const q = host.querySelector<HTMLInputElement>('#q')!;
  const results = host.querySelector<HTMLDivElement>('#results')!;
  const statusEl = host.querySelector<HTMLDivElement>('#ollama-status')!;
  const answerEl = host.querySelector<HTMLDivElement>('#answer')!;

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

  async function showAll(): Promise<void> {
    const cards = await window.localgold.listCards();
    results.innerHTML = cards.length
      ? cards.map((c) => cardHtml(c)).join('')
      : '<p class="hint">No cards yet.</p>';
  }

  q.addEventListener('input', async () => {
    const term = q.value.trim();
    if (!term) {
      await showAll();
      return;
    }
    const hits = await window.localgold.search(term);
    results.innerHTML = hits.length
      ? hits.map((h) => cardHtml(h.card, h.snippet)).join('')
      : '<p class="hint">No matches.</p>';
  });

  q.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const term = q.value.trim();
    if (!term) return;
    answerEl.innerHTML = '<h3>Answer</h3><div class="answer-text generating"></div>';
    const textEl = answerEl.querySelector<HTMLDivElement>('.answer-text')!;
    let raw = '';
    try {
      const result = await window.localgold.ask(term, (chunk) => {
        raw += chunk;
        textEl.textContent = raw;
      });
      answerEl.innerHTML = result.sources.length
        ? answerHtml(result)
        : '<h3>Answer</h3><p class="hint">No cards to answer from.</p>';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      textEl.classList.remove('generating');
      textEl.innerHTML =
        escapeHtml(raw) +
        `<p class="problem">Answer unavailable — ${escapeHtml(errorHint(message))}</p>`;
    }
  });

  answerEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('cite')) return;
    const id = target.getAttribute('data-card-id');
    if (!id) return;
    const cardEl = results.querySelector<HTMLElement>(`.card[data-card-id="${CSS.escape(id)}"]`);
    if (!cardEl) return;
    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    cardEl.classList.remove('flash');
    void cardEl.offsetWidth;
    cardEl.classList.add('flash');
  });

  void showStatus();
  void showAll();
}
