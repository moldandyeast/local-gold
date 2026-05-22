import type { DB } from './index-db';
import { staleCards, upsertEmbedding } from './index-db';
import type { Embedder } from '../shared/types';

/** Outcome of a backfill run. */
export interface BackfillResult {
  /** How many cards were embedded this run. */
  embedded: number;
  /** True if it stopped early because the embedder failed (Ollama down). */
  stopped: boolean;
}

/**
 * Embed every card whose embedding is missing or stale. Idempotent and
 * resumable: stops early (without error) if the embedder throws, leaving
 * the rest stale for a later run.
 */
export async function backfillEmbeddings(
  db: DB,
  embedder: Embedder,
  model: string
): Promise<BackfillResult> {
  const stale = staleCards(db, model);
  let embedded = 0;
  for (const card of stale) {
    let vector: Float32Array;
    try {
      vector = await embedder.embed(card.body, 'document');
    } catch {
      return { embedded, stopped: true };
    }
    if (vector.length === 0) continue;
    upsertEmbedding(db, card.id, model, vector.length, card.contentHash, vector);
    embedded += 1;
  }
  return { embedded, stopped: false };
}
