import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../src/main/config';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'lg-'));
}

describe('config', () => {
  it('returns defaults when config.json is absent', () => {
    const root = tmpRoot();
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://localhost:11434',
      embedModel: 'embeddinggemma'
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('reads values from config.json', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'config.json'),
      JSON.stringify({ ollamaUrl: 'http://host:9999', embedModel: 'other' })
    );
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://host:9999',
      embedModel: 'other'
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to defaults for missing or malformed fields', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'config.json'), '{ not valid json');
    expect(loadConfig(root)).toEqual({
      ollamaUrl: 'http://localhost:11434',
      embedModel: 'embeddinggemma'
    });
    rmSync(root, { recursive: true, force: true });
  });
});
