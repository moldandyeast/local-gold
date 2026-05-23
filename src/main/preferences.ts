import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Preferences } from '../shared/types';

/** The factory default for `dataDir`. */
export function defaultDataDir(): string {
  return join(homedir(), 'Documents', 'LocalGold');
}

function prefsPath(userDataDir: string): string {
  return join(userDataDir, 'preferences.json');
}

/**
 * Read preferences from `<userDataDir>/preferences.json`. Missing, malformed,
 * or wrong-shape files fall back to the default `{ dataDir }`.
 */
export function loadPreferences(userDataDir: string): Preferences {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(prefsPath(userDataDir), 'utf8'));
  } catch {
    return { dataDir: defaultDataDir() };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { dataDir: defaultDataDir() };
  }
  const p = parsed as { dataDir?: unknown };
  return {
    dataDir: typeof p.dataDir === 'string' && p.dataDir ? p.dataDir : defaultDataDir()
  };
}

/** Persist preferences to `<userDataDir>/preferences.json`. */
export function savePreferences(userDataDir: string, prefs: Preferences): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(prefsPath(userDataDir), JSON.stringify(prefs, null, 2), 'utf8');
}
