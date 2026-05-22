import type { Embedder, OllamaStatus } from '../shared/types';

/**
 * EmbeddingGemma prompt prefixes. The model expects a task prefix on every
 * input; query and document use different ones so a query and a card body
 * land in a comparable space.
 */
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

/** A local Ollama client: a health check plus the `Embedder` interface. */
export interface Ollama extends Embedder {
  health(): Promise<OllamaStatus>;
}

/** Build an Ollama client for a base URL and embedding model name. */
export function createOllama(ollamaUrl: string, model: string): Ollama {
  async function health(): Promise<OllamaStatus> {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!res.ok) return { reachable: false, hasEmbedModel: false };
      const data = (await res.json()) as { models?: { name: string }[] };
      const hasEmbedModel = (data.models ?? []).some((m) => m.name.startsWith(model));
      return { reachable: true, hasEmbedModel };
    } catch {
      return { reachable: false, hasEmbedModel: false };
    }
  }

  async function embed(text: string, kind: 'query' | 'document'): Promise<Float32Array> {
    const input = (kind === 'query' ? QUERY_PREFIX : DOCUMENT_PREFIX) + text;
    const res = await fetch(`${ollamaUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    if (!vec || vec.length === 0) throw new Error('Ollama embed: empty response');
    return Float32Array.from(vec);
  }

  return { health, embed };
}
