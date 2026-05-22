import { describe, it, expect } from 'vitest';
import { buildMessages } from '../src/main/answer';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-22T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('buildMessages', () => {
  it('numbers cards [1..n] and includes the question', () => {
    const msgs = buildMessages([card('a', 'first note'), card('b', 'second note')], 'what?');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toMatch(/\[n\]/);
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('[1] first note');
    expect(msgs[1].content).toContain('[2] second note');
    expect(msgs[1].content).toContain('what?');
  });
});

import { synthesizeAnswer, ANSWER_CARD_COUNT } from '../src/main/answer';
import { openDb, initSchema, upsertCard } from '../src/main/index-db';
import type { Chatter, Embedder } from '../src/shared/types';

const embedder: Embedder = { embed: async () => Float32Array.from([1, 0, 0]) };

/** Chatter that emits a fixed list of tokens. */
function fakeChatter(tokens: string[]): Chatter {
  return {
    chat: async (_messages, onToken) => {
      for (const t of tokens) onToken(t);
    }
  };
}

describe('synthesizeAnswer', () => {
  it('streams tokens and returns the assembled answer with sources', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('c1', 'a shared topic note'), '/p/c1.md', 'h');
    const chatter = fakeChatter(['Part one. ', 'Part two [1].']);
    const got: string[] = [];
    const result = await synthesizeAnswer(db, embedder, chatter, 'shared', (c) => got.push(c));
    expect(got).toEqual(['Part one. ', 'Part two [1].']);
    expect(result.answer).toBe('Part one. Part two [1].');
    expect(result.sources.map((c) => c.id)).toEqual(['c1']);
    db.close();
  });

  it('uses at most the top ANSWER_CARD_COUNT cards', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    for (let i = 0; i < ANSWER_CARD_COUNT + 4; i += 1) {
      upsertCard(db, card(`c${i}`, `shared topic note ${i}`), `/p/c${i}.md`, 'h');
    }
    const result = await synthesizeAnswer(db, embedder, fakeChatter(['x']), 'shared', () => undefined);
    expect(result.sources).toHaveLength(ANSWER_CARD_COUNT);
    db.close();
  });

  it('returns an empty answer when nothing matches', async () => {
    const db = openDb(':memory:');
    initSchema(db);
    const result = await synthesizeAnswer(db, embedder, fakeChatter(['x']), 'absent', () => undefined);
    expect(result).toEqual({ answer: '', sources: [] });
    db.close();
  });
});
