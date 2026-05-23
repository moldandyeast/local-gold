import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { cardsDir, attachmentsDir, dbPath } from './paths';
import { loadPreferences, defaultDataDir } from './preferences';
import { openDb, initSchema, rebuildIndex } from './index-db';
import { registerIpc } from './ipc';
import { loadConfig } from './config';
import { createOllama } from './ollama';
import { backfillEmbeddings } from './embeddings';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js') }
  });
  win.on('ready-to-show', () => win.show());
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // macOS dock icon (dev runs; a packaged build would set this via its config).
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(app.getAppPath(), 'build', 'icon.png'));
  }

  const userDataDir = app.getPath('userData');
  const prefs = loadPreferences(userDataDir);
  let root = prefs.dataDir;
  try {
    await mkdir(cardsDir(root), { recursive: true });
    await mkdir(attachmentsDir(root), { recursive: true });
  } catch {
    // The chosen folder is unusable — fall back to the default so the app
    // still starts. Settings will surface the mismatch.
    root = defaultDataDir();
    await mkdir(cardsDir(root), { recursive: true });
    await mkdir(attachmentsDir(root), { recursive: true });
  }

  const config = loadConfig(root);
  const ollama = createOllama(config.ollamaUrl, config.embedModel, config.answerModel);

  const db = openDb(dbPath(root));
  initSchema(db);
  await rebuildIndex(db, root);
  registerIpc(db, root, ollama, config.embedModel, userDataDir);

  // Backfill embeddings in the background — does not block the window.
  void backfillEmbeddings(db, ollama, config.embedModel).catch(() => undefined);

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
