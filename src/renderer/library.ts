import type { Card } from '../shared/types';

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
  return `<div class="card">
    <div class="meta">${escapeHtml(card.created)}</div>
    <div>${text}</div>
    <div>${tags}</div>${attach}
  </div>`;
}

/** Render the library / search view into `host`. */
export function renderLibrary(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Library</h2>
    <input id="q" type="text" placeholder="Search cards…" />
    <div id="results"></div>
  `;
  const q = host.querySelector<HTMLInputElement>('#q')!;
  const results = host.querySelector<HTMLDivElement>('#results')!;

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

  void showAll();
}
