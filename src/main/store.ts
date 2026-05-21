import { createHash } from 'crypto';
import matter from 'gray-matter';
import type { Card } from '../shared/types';

/** Build a URL-safe slug from the first six words of a body. */
export function slugify(body: string): string {
  const slug = body
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
    .slice(0, 40);
  return slug || 'card';
}

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
  return {
    id: typeof data.id === 'string' ? data.id : fallbackId,
    created,
    body: content.trim(),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    attachments: Array.isArray(data.attachments) ? data.attachments.map(String) : []
  };
}
