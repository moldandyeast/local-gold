import type { Chatter, ChatMessage, Embedder, OllamaStatus } from '../shared/types';

/**
 * EmbeddingGemma prompt prefixes. The model expects a task prefix on every
 * input; query and document use different ones so a query and a card body
 * land in a comparable space.
 */
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';

/** A local Ollama client: health check, embeddings, and streaming chat. */
export interface Ollama extends Embedder, Chatter {
  health(): Promise<OllamaStatus>;
  /** Non-streaming completion; with a JSON-schema `format`, returns parsed JSON. */
  complete(
    prompt: string,
    opts?: { images?: string[]; format?: unknown }
  ): Promise<unknown>;
}

/** Build an Ollama client for a base URL, embedding model and chat model. */
export function createOllama(
  ollamaUrl: string,
  model: string,
  chatModel = 'gemma4:e4b'
): Ollama {
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

  async function chat(
    messages: ChatMessage[],
    onToken: (chunk: string) => void
  ): Promise<void> {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: chatModel, messages, stream: true }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`Ollama chat failed: HTTP ${res.status}`);
    if (!res.body) throw new Error('Ollama chat: no response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as { message?: { content?: string } };
        if (obj.message?.content) onToken(obj.message.content);
      }
    }
  }

  async function complete(
    prompt: string,
    opts: { images?: string[]; format?: unknown } = {}
  ): Promise<unknown> {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        prompt,
        images: opts.images,
        format: opts.format,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) throw new Error(`Ollama generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as { response?: string };
    return JSON.parse(data.response ?? 'null');
  }

  return { health, embed, chat, complete };
}
