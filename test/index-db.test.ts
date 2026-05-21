import { describe, it, expect } from 'vitest';
import { openDb, initSchema } from '../src/main/index-db';

describe('index-db: schema', () => {
  it('creates the cards, cards_fts and meta tables', () => {
    const db = openDb(':memory:');
    initSchema(db);
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(names).toContain('cards');
    expect(names).toContain('cards_fts');
    expect(names).toContain('meta');
    db.close();
  });

  it('is idempotent — initSchema can run twice', () => {
    const db = openDb(':memory:');
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
    db.close();
  });
});
