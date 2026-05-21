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
