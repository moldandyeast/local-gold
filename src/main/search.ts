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
