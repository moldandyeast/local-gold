import { contextBridge, ipcRenderer } from 'electron';
import type { Card, NewCard, SearchResult, OllamaStatus } from '../shared/types';

/** The API exposed to the renderer as `window.localgold`. */
export interface LocalGoldApi {
  createCard(input: NewCard): Promise<Card>;
  listCards(limit?: number, offset?: number): Promise<Card[]>;
  getCard(id: string): Promise<Card | null>;
  search(query: string): Promise<SearchResult[]>;
  rebuild(): Promise<void>;
  ollamaStatus(): Promise<OllamaStatus>;
}

const api: LocalGoldApi = {
  createCard: (input) => ipcRenderer.invoke('card:create', input),
  listCards: (limit, offset) => ipcRenderer.invoke('card:list', limit, offset),
  getCard: (id) => ipcRenderer.invoke('card:get', id),
  search: (query) => ipcRenderer.invoke('search:query', query),
  rebuild: () => ipcRenderer.invoke('index:rebuild'),
  ollamaStatus: () => ipcRenderer.invoke('ollama:status')
};

contextBridge.exposeInMainWorld('localgold', api);
