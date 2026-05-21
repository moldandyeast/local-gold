import { ipcMain } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { DB } from './index-db';
import { upsertCard, getCard, listCards, rebuildIndex } from './index-db';
import { writeCard, hashContent } from './store';
import { keywordSearch } from './search';
import { cardsDir } from './paths';
import type { NewCard } from '../shared/types';

/** Register every IPC handler the renderer relies on. Call once at startup. */
export function registerIpc(db: DB, root: string): void {
  ipcMain.handle('card:create', async (_e, input: NewCard) => {
    const card = await writeCard(root, input);
    const filePath = join(cardsDir(root), `${card.id}.md`);
    const raw = await readFile(filePath, 'utf8');
    upsertCard(db, card, filePath, hashContent(raw));
    return card;
  });

  ipcMain.handle('card:list', (_e, limit = 100, offset = 0) => listCards(db, limit, offset));

  ipcMain.handle('card:get', (_e, id: string) => getCard(db, id));

  ipcMain.handle('search:query', (_e, query: string) => keywordSearch(db, query));

  ipcMain.handle('index:rebuild', () => rebuildIndex(db, root));
}
