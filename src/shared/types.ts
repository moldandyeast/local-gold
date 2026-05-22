/** A stored insight card. */
export interface Card {
  /** Filename stem "YYYY-MM-DD-<uid>", e.g. "2026-05-21-a3f8c1d2". */
  id: string;
  /** ISO 8601 creation timestamp. */
  created: string;
  /** Freeform Markdown body. */
  body: string;
  /** Manual tags. */
  tags: string[];
  /** Attachment paths relative to the LocalGold root, e.g. "attachments/x-1.png". */
  attachments: string[];
}

/** A card submitted from the renderer, before it is written to disk. */
export interface NewCard {
  body: string;
  tags: string[];
  images: { name: string; data: Uint8Array }[];
}

/** A search hit: the card, a relevance score, and a highlighted snippet. */
export interface SearchResult {
  card: Card;
  score: number;
  snippet: string;
}

/** Embeds text into a vector. `kind` selects EmbeddingGemma's prompt. */
export interface Embedder {
  embed(text: string, kind: 'query' | 'document'): Promise<Float32Array>;
}

/** Reachability of the local Ollama embedding service. */
export interface OllamaStatus {
  /** Ollama answered an HTTP request. */
  reachable: boolean;
  /** The configured embedding model is pulled. */
  hasEmbedModel: boolean;
}

/** One message in a chat exchange. */
export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** A streaming chat model. `onToken` is called with each text chunk. */
export interface Chatter {
  chat(messages: ChatMessage[], onToken: (chunk: string) => void): Promise<void>;
}
