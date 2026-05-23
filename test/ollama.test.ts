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

describe('ollama: chat', () => {
  it('streams tokens from /api/chat in order', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/chat') {
        res.write(JSON.stringify({ message: { content: 'Hello' } }) + '\n');
        res.write(JSON.stringify({ message: { content: ' world' }, done: true }) + '\n');
        res.end();
      }
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    const chunks: string[] = [];
    await ollama.chat([{ role: 'user', content: 'hi' }], (c) => chunks.push(c));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('throws when chat returns a non-200', async () => {
    const url = await stubOllama((reqUrl, res) => {
      res.statusCode = 500;
      res.end('err');
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    await expect(
      ollama.chat([{ role: 'user', content: 'hi' }], () => undefined)
    ).rejects.toThrow();
  });
});

describe('ollama: complete', () => {
  it('parses a JSON response from /api/generate', async () => {
    const url = await stubOllama((reqUrl, res) => {
      if (reqUrl === '/api/generate') {
        res.end(JSON.stringify({ response: '{"description":"a cat","tags":["cat"]}' }));
      }
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    const result = await ollama.complete('describe', { format: { type: 'object' } });
    expect(result).toEqual({ description: 'a cat', tags: ['cat'] });
  });

  it('throws when generate returns a non-200', async () => {
    const url = await stubOllama((_reqUrl, res) => {
      res.statusCode = 500;
      res.end('err');
    });
    const ollama = createOllama(url, 'embeddinggemma', 'gemma4:e4b');
    await expect(ollama.complete('describe')).rejects.toThrow();
  });
});
