import type { DB } from './index-db';
import { searchFts, getCard } from './index-db';
import type { SearchResult } from '../shared/types';

/**
 * Phase 1 search: keyword (FTS5) only. Results keep FTS rank order.
 * `score` is a placeholder (1) until Phase 2 introduces semantic ranking.
 */
export function keywordSearch(db: DB, query: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const hit of searchFts(db, query)) {
    const card = getCard(db, hit.id);
    if (!card) continue;
    results.push({ card, score: 1, snippet: hit.snippet });
  }
  return results;
}

import { getEmbeddings } from './index-db';
import { cosineSimilarity } from './rank';
import type { Embedder } from '../shared/types';

/**
 * Semantic search: embed the query and rank cards by cosine similarity to
 * their stored embeddings. Brute-force over all vectors; top 50 returned.
 */
export async function semanticSearch(
  db: DB,
  embedder: Embedder,
  query: string
): Promise<SearchResult[]> {
  const queryVec = await embedder.embed(query, 'query');
  const scored = getEmbeddings(db)
    .map((e) => ({ id: e.cardId, score: cosineSimilarity(queryVec, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  const results: SearchResult[] = [];
  for (const s of scored) {
    const card = getCard(db, s.id);
    if (!card) continue;
    results.push({ card, score: s.score, snippet: card.body.slice(0, 240) });
  }
  return results;
}

import { reciprocalRankFusion } from './rank';

/**
 * Hybrid search: run keyword (FTS5) and semantic search, fuse the two
 * rankings with Reciprocal Rank Fusion. If the embedder fails (Ollama
 * unavailable), returns the keyword results alone.
 */
export async function hybridSearch(
  db: DB,
  embedder: Embedder,
  query: string
): Promise<SearchResult[]> {
  const keyword = keywordSearch(db, query);
  let semantic: SearchResult[] = [];
  try {
    semantic = await semanticSearch(db, embedder, query);
  } catch {
    semantic = [];
  }

  // Keyword first, so a card matching both keeps its highlighted snippet.
  const byId = new Map<string, SearchResult>();
  for (const r of [...keyword, ...semantic]) {
    if (!byId.has(r.card.id)) byId.set(r.card.id, r);
  }

  const fused = reciprocalRankFusion([
    keyword.map((r) => r.card.id),
    semantic.map((r) => r.card.id)
  ]);

  return fused.map((f) => {
    const base = byId.get(f.id)!;
    return { card: base.card, score: f.score, snippet: base.snippet };
  });
}
