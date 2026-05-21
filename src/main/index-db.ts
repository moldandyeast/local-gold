import Database from 'better-sqlite3';

export type DB = Database.Database;

/** Open (or create) a SQLite database at `path`. Use ':memory:' for tests. */
export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  return db;
}

/** Create all tables, the FTS5 index, and its sync triggers. Idempotent. */
export function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      created      TEXT NOT NULL,
      body         TEXT NOT NULL,
      tags         TEXT NOT NULL DEFAULT '[]',
      attachments  TEXT NOT NULL DEFAULT '[]',
      file_path    TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      body, tags, content='cards', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
      INSERT INTO cards_fts(rowid, body, tags) VALUES (new.rowid, new.body, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, body, tags)
        VALUES ('delete', old.rowid, old.body, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, body, tags)
        VALUES ('delete', old.rowid, old.body, old.tags);
      INSERT INTO cards_fts(rowid, body, tags) VALUES (new.rowid, new.body, new.tags);
    END;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}
