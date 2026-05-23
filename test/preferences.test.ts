import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadPreferences, savePreferences, defaultDataDir } from '../src/main/preferences';

function tmpUserData(): string {
  return mkdtempSync(join(tmpdir(), 'lg-ud-'));
}

describe('preferences', () => {
  it('returns the default dataDir when no preferences file exists', () => {
    const ud = tmpUserData();
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });

  it('round-trips a saved preference', () => {
    const ud = tmpUserData();
    savePreferences(ud, { dataDir: '/some/path' });
    expect(loadPreferences(ud)).toEqual({ dataDir: '/some/path' });
    rmSync(ud, { recursive: true, force: true });
  });

  it('falls back to the default when preferences.json is malformed', () => {
    const ud = tmpUserData();
    writeFileSync(join(ud, 'preferences.json'), '{ not valid json');
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });

  it('falls back to the default when dataDir is the wrong type', () => {
    const ud = tmpUserData();
    writeFileSync(join(ud, 'preferences.json'), JSON.stringify({ dataDir: 123 }));
    expect(loadPreferences(ud)).toEqual({ dataDir: defaultDataDir() });
    rmSync(ud, { recursive: true, force: true });
  });
});
