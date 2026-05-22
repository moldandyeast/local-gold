import type { Card, ChatMessage } from '../shared/types';

const SYSTEM_PROMPT =
  "You answer the user's question using only the numbered cards provided. " +
  'Cite the cards that support each claim inline as [n], matching the card numbers. ' +
  'Be concise. If the cards do not cover the question, say so plainly.';

/** Build the chat messages for a grounded answer over numbered cards. */
export function buildMessages(cards: Card[], query: string): ChatMessage[] {
  const numbered = cards.map((c, i) => `[${i + 1}] ${c.body}`).join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Cards:\n\n${numbered}\n\nQuestion: ${query}` }
  ];
}

import type { DB } from './index-db';
import { hybridSearch } from './search';
import type { AnswerResult, Chatter, Embedder } from '../shared/types';

/** How many top search-result cards are fed to the model. */
export const ANSWER_CARD_COUNT = 8;

/**
 * Retrieve the top cards for `query`, prompt the chat model to answer from
 * them, and stream the answer back through `onToken`. Returns the full answer
 * and the source cards. If nothing matches, returns an empty answer.
 */
export async function synthesizeAnswer(
  db: DB,
  embedder: Embedder,
  chatter: Chatter,
  query: string,
  onToken: (chunk: string) => void
): Promise<AnswerResult> {
  const hits = await hybridSearch(db, embedder, query);
  const sources = hits.slice(0, ANSWER_CARD_COUNT).map((h) => h.card);
  if (sources.length === 0) return { answer: '', sources: [] };

  let answer = '';
  await chatter.chat(buildMessages(sources, query), (chunk) => {
    answer += chunk;
    onToken(chunk);
  });
  return { answer, sources };
}
