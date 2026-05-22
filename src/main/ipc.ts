import { ipcMain } from 'electron';
import { join } from 'path';
import { readFile } from 'fs/promises';
import type { DB } from './index-db';
import { upsertCard, getCard, listCards, rebuildIndex } from './index-db';
import { writeCard, hashContent } from './store';
import { hybridSearch } from './search';
import { backfillEmbeddings } from './embeddings';
import { synthesizeAnswer } from './answer';
import { cardsDir } from './paths';
import type { Ollama } from './ollama';
import type { NewCard } from '../shared/types';

/** Register every IPC handler the renderer relies on. Call once at startup. */
export function registerIpc(db: DB, root: string, ollama: Ollama, model: string): void {
  ipcMain.handle('card:create', async (_e, input: NewCard) => {
    const card = await writeCard(root, input);
    const filePath = join(cardsDir(root), `${card.id}.md`);
    const raw = await readFile(filePath, 'utf8');
    upsertCard(db, card, filePath, hashContent(raw));
    // Embed the new card in the background; never block the response.
    void backfillEmbeddings(db, ollama, model).catch(() => undefined);
    return card;
  });

  ipcMain.handle('card:list', (_e, limit = 100, offset = 0) => listCards(db, limit, offset));

  ipcMain.handle('card:get', (_e, id: string) => getCard(db, id));

  ipcMain.handle('search:query', (_e, query: string) => hybridSearch(db, ollama, query));

  ipcMain.handle('index:rebuild', () => rebuildIndex(db, root));

  ipcMain.handle('ollama:status', () => ollama.health());

  // Streaming: tokens flow back as answer:token, ending with done or error.
  ipcMain.on('answer:ask', async (e, query: string) => {
    try {
      const result = await synthesizeAnswer(db, ollama, ollama, query, (chunk) => {
        e.sender.send('answer:token', chunk);
      });
      e.sender.send('answer:done', result);
    } catch (err) {
      e.sender.send('answer:error', err instanceof Error ? err.message : String(err));
    }
  });
}
