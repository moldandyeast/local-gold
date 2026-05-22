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
    CREATE TABLE IF NOT EXISTS embeddings (
      card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      model        TEXT NOT NULL,
      dim          INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      vector       BLOB NOT NULL
    );
  `);
}

import type { Card } from '../shared/types';

interface CardRow {
  id: string;
  created: string;
  body: string;
  tags: string;
  attachments: string;
}

function rowToCard(row: CardRow): Card {
  return {
    id: row.id,
    created: row.created,
    body: row.body,
    tags: JSON.parse(row.tags),
    attachments: JSON.parse(row.attachments)
  };
}

/** Insert a card, or update it in place if its id already exists. */
export function upsertCard(db: DB, card: Card, filePath: string, hash: string): void {
  db.prepare(
    `INSERT INTO cards (id, created, body, tags, attachments, file_path, content_hash)
     VALUES (@id, @created, @body, @tags, @attachments, @file_path, @content_hash)
     ON CONFLICT(id) DO UPDATE SET
       created=@created, body=@body, tags=@tags, attachments=@attachments,
       file_path=@file_path, content_hash=@content_hash`
  ).run({
    id: card.id,
    created: card.created,
    body: card.body,
    tags: JSON.stringify(card.tags),
    attachments: JSON.stringify(card.attachments),
    file_path: filePath,
    content_hash: hash
  });
}

/** Remove a card from the index. */
export function deleteCard(db: DB, id: string): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(id);
}

/** Fetch a card by id, or null. */
export function getCard(db: DB, id: string): Card | null {
  const row = db
    .prepare('SELECT id, created, body, tags, attachments FROM cards WHERE id = ?')
    .get(id) as CardRow | undefined;
  return row ? rowToCard(row) : null;
}

/** Cards newest first, paginated. */
export function listCards(db: DB, limit: number, offset: number): Card[] {
  const rows = db
    .prepare(
      'SELECT id, created, body, tags, attachments FROM cards ORDER BY created DESC LIMIT ? OFFSET ?'
    )
    .all(limit, offset) as CardRow[];
  return rows.map(rowToCard);
}

/** Map of card id to its stored content hash. */
export function allHashes(db: DB): Map<string, string> {
  const rows = db.prepare('SELECT id, content_hash FROM cards').all() as {
    id: string;
    content_hash: string;
  }[];
  return new Map(rows.map((r) => [r.id, r.content_hash]));
}

/** Turn a freeform query into a safe FTS5 MATCH expression of quoted terms. */
function ftsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' ');
}

/** Keyword search over body + tags. Returns ids and highlighted snippets, ranked. */
export function searchFts(db: DB, query: string): { id: string; snippet: string }[] {
  const match = ftsQuery(query);
  if (!match) return [];
  return db
    .prepare(
      `SELECT c.id AS id, snippet(cards_fts, 0, '«', '»', '…', 12) AS snippet
       FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
       WHERE cards_fts MATCH ? ORDER BY rank LIMIT 50`
    )
    .all(match) as { id: string; snippet: string }[];
}

import { listCardFiles, parseCard } from './store';

/**
 * Reconcile the index with the `cards/` folder: upsert new or changed files,
 * delete index rows whose file is gone, skip files whose hash is unchanged.
 */
export async function rebuildIndex(db: DB, root: string): Promise<void> {
  const files = await listCardFiles(root);
  const known = allHashes(db);
  const onDisk = new Set<string>();

  for (const file of files) {
    onDisk.add(file.id);
    if (known.get(file.id) === file.hash) continue;
    const card = parseCard(file.raw, file.id);
    upsertCard(db, card, file.filePath, file.hash);
  }

  for (const id of known.keys()) {
    if (!onDisk.has(id)) deleteCard(db, id);
  }
}

/** Encode a Float32 vector as a SQLite BLOB. */
function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/** Decode a SQLite BLOB back into a Float32 vector (copying, so it is standalone). */
function blobToVector(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Insert or replace a card's embedding. */
export function upsertEmbedding(
  db: DB,
  cardId: string,
  model: string,
  dim: number,
  contentHash: string,
  vector: Float32Array
): void {
  db.prepare(
    `INSERT INTO embeddings (card_id, model, dim, content_hash, vector)
     VALUES (@card_id, @model, @dim, @content_hash, @vector)
     ON CONFLICT(card_id) DO UPDATE SET
       model=@model, dim=@dim, content_hash=@content_hash, vector=@vector`
  ).run({
    card_id: cardId,
    model,
    dim,
    content_hash: contentHash,
    vector: vectorToBlob(vector)
  });
}

/** Every stored embedding, as card id + decoded vector. */
export function getEmbeddings(db: DB): { cardId: string; vector: Float32Array }[] {
  const rows = db.prepare('SELECT card_id, vector FROM embeddings').all() as {
    card_id: string;
    vector: Buffer;
  }[];
  return rows.map((r) => ({ cardId: r.card_id, vector: blobToVector(r.vector) }));
}

/** Cards whose embedding is missing, stale (content changed), or from another model. */
export function staleCards(
  db: DB,
  model: string
): { id: string; body: string; contentHash: string }[] {
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.body AS body, c.content_hash AS contentHash
       FROM cards c LEFT JOIN embeddings e ON e.card_id = c.id
       WHERE e.card_id IS NULL OR e.content_hash != c.content_hash OR e.model != ?`
    )
    .all(model) as { id: string; body: string; contentHash: string }[];
  return rows;
}
