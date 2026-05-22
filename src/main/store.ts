import { createHash, randomBytes } from 'crypto';
import matter from 'gray-matter';
import type { Card } from '../shared/types';

/** sha256 hex digest of a string. */
export function hashContent(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Serialize a card to Markdown with YAML frontmatter. */
export function serializeCard(card: Card): string {
  const lines = [
    '---',
    `id: ${card.id}`,
    `created: ${card.created}`,
    `tags: [${card.tags.join(', ')}]`
  ];
  if (card.url) {
    lines.push(`url: ${card.url}`);
  }
  if (card.attachments.length > 0) {
    lines.push(`attachments: [${card.attachments.join(', ')}]`);
  }
  lines.push('---', '', card.body, '');
  return lines.join('\n');
}

/** Parse a Markdown card file. `fallbackId` is used if frontmatter omits `id`. */
export function parseCard(raw: string, fallbackId: string): Card {
  const { data, content } = matter(raw);
  const created =
    typeof data.created === 'string'
      ? data.created
      : data.created instanceof Date
        ? data.created.toISOString()
        : new Date(0).toISOString();
  const card: Card = {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    created,
    body: content.trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : []
  };
  if (typeof data.url === 'string' && data.url.trim()) {
    card.url = data.url.trim();
  }
  return card;
}

import { mkdir, readdir, readFile, writeFile, access } from 'fs/promises';
import { join, extname } from 'path';
import { cardsDir, attachmentsDir } from './paths';
import type { NewCard } from '../shared/types';

/** A card file on disk with its raw contents and content hash. */
export interface CardFile {
  id: string;
  filePath: string;
  raw: string;
  hash: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * Build the filename stem "YYYY-MM-DD-uid" for a card. The date groups cards
 * for human browsing; the random UID keeps the name stable when the body is
 * later edited (a body-derived slug would go stale).
 */
function cardStem(created: Date): string {
  const date =
    `${created.getFullYear()}-${pad(created.getMonth() + 1, 2)}-${pad(created.getDate(), 2)}`;
  return `${date}-${randomBytes(4).toString('hex')}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** A stem whose `.md` file does not already exist; regenerates the UID on collision. */
async function uniqueStem(root: string, created: Date): Promise<string> {
  let stem = cardStem(created);
  while (await exists(join(cardsDir(root), `${stem}.md`))) {
    stem = cardStem(created);
  }
  return stem;
}

/** Write a new card (and its images) to disk and return the stored Card. */
export async function writeCard(root: string, input: NewCard): Promise<Card> {
  const created = new Date();
  await mkdir(cardsDir(root), { recursive: true });
  await mkdir(attachmentsDir(root), { recursive: true });
  const stem = await uniqueStem(root, created);

  const attachments: string[] = [];
  for (let i = 0; i < input.images.length; i += 1) {
    const img = input.images[i];
    const ext = extname(img.name) || '.png';
    const rel = join('attachments', `${stem}-${i + 1}${ext}`);
    await writeFile(join(root, rel), Buffer.from(img.data));
    attachments.push(rel);
  }

  const card: Card = {
    id: stem,
    created: created.toISOString(),
    body: input.body,
    tags: input.tags,
    attachments
  };
  if (input.url && input.url.trim()) {
    card.url = input.url.trim();
  }
  await writeFile(join(cardsDir(root), `${stem}.md`), serializeCard(card), 'utf8');
  return card;
}

/** List every card file with its raw contents and hash. Empty if no cards dir. */
export async function listCardFiles(root: string): Promise<CardFile[]> {
  let names: string[];
  try {
    names = await readdir(cardsDir(root));
  } catch {
    return [];
  }
  const files: CardFile[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(cardsDir(root), name);
    const raw = await readFile(filePath, 'utf8');
    files.push({ id: name.slice(0, -3), filePath, raw, hash: hashContent(raw) });
  }
  return files;
}

/** All cards, parsed, sorted newest first. */
export async function listCards(root: string): Promise<Card[]> {
  const files = await listCardFiles(root);
  return files
    .map((f) => parseCard(f.raw, f.id))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Read a single card by id, or null if it does not exist. */
export async function readCard(root: string, id: string): Promise<Card | null> {
  try {
    const raw = await readFile(join(cardsDir(root), `${id}.md`), 'utf8');
    return parseCard(raw, id);
  } catch {
    return null;
  }
}
