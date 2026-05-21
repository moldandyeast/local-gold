import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { rootDir, cardsDir, attachmentsDir, dbPath } from '../src/main/paths';

describe('paths', () => {
  it('uses LOCALGOLD_DIR when set', () => {
    process.env.LOCALGOLD_DIR = '/tmp/lg-test';
    expect(rootDir()).toBe('/tmp/lg-test');
    delete process.env.LOCALGOLD_DIR;
  });

  it('derives subpaths from a root', () => {
    expect(cardsDir('/r')).toBe(join('/r', 'cards'));
    expect(attachmentsDir('/r')).toBe(join('/r', 'attachments'));
    expect(dbPath('/r')).toBe(join('/r', 'index.db'));
  });
});

import { parseCard, serializeCard, slugify, hashContent } from '../src/main/store';

describe('store: serialize/parse', () => {
  it('slugifies the first words of a body', () => {
    expect(slugify('First thoughts on X!')).toBe('first-thoughts-on-x');
    expect(slugify('   ')).toBe('card');
  });

  it('round-trips a card through serialize then parse', () => {
    const card = {
      id: '20260521-093000-hello',
      created: '2026-05-21T09:30:00.000Z',
      body: 'Hello world.\nSecond line.',
      tags: ['idea', 'research'],
      attachments: ['attachments/20260521-093000-hello-1.png']
    };
    const parsed = parseCard(serializeCard(card), 'fallback');
    expect(parsed).toEqual(card);
  });

  it('parses a card with no tags or attachments', () => {
    const raw = '---\nid: x\ncreated: 2026-01-01T00:00:00.000Z\ntags: []\n---\n\nbody\n';
    const parsed = parseCard(raw, 'x');
    expect(parsed.tags).toEqual([]);
    expect(parsed.attachments).toEqual([]);
    expect(parsed.body).toBe('body');
  });

  it('falls back to the given id when frontmatter omits it', () => {
    const raw = '---\ncreated: 2026-01-01T00:00:00.000Z\ntags: []\n---\n\nbody\n';
    expect(parseCard(raw, 'fallback-id').id).toBe('fallback-id');
  });

  it('hashContent is stable and content-sensitive', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });
});
