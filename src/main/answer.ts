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
