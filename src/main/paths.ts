import { homedir } from 'os';
import { join } from 'path';

/** The LocalGold root directory. Overridable via LOCALGOLD_DIR (used in tests). */
export function rootDir(): string {
  return process.env.LOCALGOLD_DIR ?? join(homedir(), 'Documents', 'LocalGold');
}

export function cardsDir(root: string): string {
  return join(root, 'cards');
}

export function attachmentsDir(root: string): string {
  return join(root, 'attachments');
}

export function dbPath(root: string): string {
  return join(root, 'index.db');
}
