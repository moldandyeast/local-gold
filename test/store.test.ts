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

import { parseCard, serializeCard, hashContent } from '../src/main/store';

describe('store: serialize/parse', () => {
  it('round-trips a card through serialize then parse', () => {
    const card = {
      id: '2026-05-21-a1b2c3d4',
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

import { writeCard, listCards, listCardFiles, readCard } from '../src/main/store';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join as pjoin } from 'path';

describe('store: write/list/read', () => {
  function tmpRoot(): string {
    return mkdtempSync(pjoin(tmpdir(), 'lg-'));
  }

  it('writes a card file and an image attachment', async () => {
    const root = tmpRoot();
    const card = await writeCard(root, {
      body: 'A captured thought',
      tags: ['idea'],
      images: [{ name: 'pic.png', data: new Uint8Array([1, 2, 3]) }]
    });
    expect(card.id).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    expect(card.attachments).toHaveLength(1);
    const read = await readCard(root, card.id);
    expect(read?.body).toBe('A captured thought');
    rmSync(root, { recursive: true, force: true });
  });

  it('lists cards newest first', async () => {
    const root = tmpRoot();
    const first = await writeCard(root, { body: 'older', tags: [], images: [] });
    await new Promise((r) => setTimeout(r, 1100));
    const second = await writeCard(root, { body: 'newer', tags: [], images: [] });
    const all = await listCards(root);
    expect(all.map((c) => c.id)).toEqual([second.id, first.id]);
    rmSync(root, { recursive: true, force: true });
  });

  it('listCardFiles returns raw contents and a hash', async () => {
    const root = tmpRoot();
    const card = await writeCard(root, { body: 'hashme', tags: [], images: [] });
    const files = await listCardFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe(card.id);
    expect(files[0].hash).toHaveLength(64);
    rmSync(root, { recursive: true, force: true });
  });

  it('listCardFiles returns empty when cards dir is absent', async () => {
    const root = tmpRoot();
    expect(await listCardFiles(root)).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });
});
