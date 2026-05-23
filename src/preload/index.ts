import { contextBridge, ipcRenderer } from 'electron';
import type {
  Card,
  NewCard,
  SearchResult,
  OllamaStatus,
  AnswerResult,
  Enrichment,
  Preferences
} from '../shared/types';

/** The API exposed to the renderer as `window.localgold`. */
export interface LocalGoldApi {
  createCard(input: NewCard): Promise<Card>;
  listCards(limit?: number, offset?: number): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  search(query: string): Promise<SearchResult[]>;
  rebuild(): Promise<void>;
  ollamaStatus(): Promise<OllamaStatus>;
  pickImages(): Promise<NewCard['images']>;
  enrichImage(data: Uint8Array): Promise<Enrichment>;
  enrichUrl(url: string): Promise<Enrichment>;
  enrichText(text: string): Promise<Enrichment>;
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
  readAttachment(rel: string): Promise<Uint8Array>;
  getPreferences(): Promise<Preferences>;
  setPreferences(prefs: Preferences): Promise<Preferences>;
  getEffectiveDataDir(): Promise<string>;
  pickFolder(): Promise<string | null>;
  revealFolder(path: string): Promise<void>;
  quitApp(): Promise<void>;
  ask(query: string, onToken: (chunk: string) => void): Promise<AnswerResult>;
}

const api: LocalGoldApi = {
  createCard: (input) => ipcRenderer.invoke('card:create', input),
  listCards: (limit, offset) => ipcRenderer.invoke('card:list', limit, offset),
  getCard: (id) => ipcRenderer.invoke('card:get', id),
  search: (query) => ipcRenderer.invoke('search:query', query),
  rebuild: () => ipcRenderer.invoke('index:rebuild'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  pickImages: () => ipcRenderer.invoke('dialog:pick-images'),
  enrichImage: (data) => ipcRenderer.invoke('enrich:image', data),
  enrichUrl: (url) => ipcRenderer.invoke('enrich:url', url),
  enrichText: (text) => ipcRenderer.invoke('enrich:text', text),
  transcribe: (samples, sampleRate) => ipcRenderer.invoke('transcribe:audio', samples, sampleRate),
  readAttachment: (rel) => ipcRenderer.invoke('read:attachment', rel),
  getPreferences: () => ipcRenderer.invoke('preferences:get'),
  setPreferences: (prefs) => ipcRenderer.invoke('preferences:set', prefs),
  getEffectiveDataDir: () => ipcRenderer.invoke('runtime:data-dir'),
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  revealFolder: (path) => ipcRenderer.invoke('shell:reveal-folder', path),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  ask: (query, onToken) =>
    new Promise<AnswerResult>((resolve, reject) => {
      const onTok = (_e: unknown, chunk: string): void => onToken(chunk);
      const onDone = (_e: unknown, result: AnswerResult): void => {
        cleanup();
        resolve(result);
      };
      const onErr = (_e: unknown, message: string): void => {
        cleanup();
        reject(new Error(message));
      };
      function cleanup(): void {
        ipcRenderer.off('answer:token', onTok);
        ipcRenderer.off('answer:done', onDone);
        ipcRenderer.off('answer:error', onErr);
      }
      ipcRenderer.on('answer:token', onTok);
      ipcRenderer.once('answer:done', onDone);
      ipcRenderer.once('answer:error', onErr);
      ipcRenderer.send('answer:ask', query);
    })
};

contextBridge.exposeInMainWorld('localgold', api);
