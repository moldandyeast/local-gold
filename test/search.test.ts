import { describe, it, expect } from 'vitest';
import { openDb, initSchema, upsertCard } from '../src/main/index-db';
import { keywordSearch } from '../src/main/search';
import type { Card } from '../src/shared/types';

function card(id: string, body: string): Card {
  return { id, created: '2026-05-21T09:00:00.000Z', body, tags: [], attachments: [] };
}

describe('search: keyword', () => {
  it('returns matching cards with a snippet', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'meeting notes about pricing'), '/p/a.md', 'h');
    upsertCard(db, card('b', 'unrelated grocery list'), '/p/b.md', 'h');
    const results = keywordSearch(db, 'pricing');
    expect(results).toHaveLength(1);
    expect(results[0].card.id).toBe('a');
    expect(results[0].snippet).toContain('«pricing»');
    db.close();
  });

  it('returns an empty array when nothing matches', () => {
    const db = openDb(':memory:');
    initSchema(db);
    upsertCard(db, card('a', 'hello'), '/p/a.md', 'h');
    expect(keywordSearch(db, 'absent')).toEqual([]);
    db.close();
  });
});
