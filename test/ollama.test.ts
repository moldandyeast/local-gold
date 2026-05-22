import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createOllama } from '../src/main/ollama';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Start a stub Ollama server; returns its base URL. */
function stubOllama(handler: (url: string, res: import('http').ServerResponse) => void): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => handler(req.url ?? '', res));
    server.listen(0, '127.0.0.1', () => {
      const port = (server!.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('ollama: health', () => {
  it('reports reachable and model present', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'embeddinggemma:latest' }] }));
      }
    });
    const ollama = createOllama(url, 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: true, hasEmbedModel: true });
  });

  it('reports reachable but model missing', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'llama3:latest' }] }));
    });
    const ollama = createOllama(url, 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: true, hasEmbedModel: false });
  });

  it('reports unreachable when nothing is listening', async () => {
    const ollama = createOllama('http://127.0.0.1:1', 'embeddinggemma');
    expect(await ollama.health()).toEqual({ reachable: false, hasEmbedModel: false });
  });
});

describe('ollama: embed', () => {
  it('returns a Float32 vector from /api/embed', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/embed') res.end(JSON.stringify({ embeddings: [[0.5, 0.25, 0.125]] }));
    });
    const ollama = createOllama(url, 'embeddinggemma');
    const vec = await ollama.embed('hello', 'query');
    expect(Array.from(vec)).toEqual([0.5, 0.25, 0.125]);
  });

  it('throws when Ollama returns a non-200', async () => {
    const url = await stubOllama((reqUrl, res) => {
      res.statusCode = 500;
      res.end('error');
    });
    const ollama = createOllama(url, 'embeddinggemma');
    await expect(ollama.embed('hello', 'query')).rejects.toThrow();
  });
});
