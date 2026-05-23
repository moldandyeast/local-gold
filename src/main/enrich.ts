import type { Enrichment } from '../shared/types';
import { extractText } from './webpage';

/** Fetches a URL and returns the response body as text. */
export type Fetcher = (url: string) => Promise<string>;

/** A non-streaming structured completion source (satisfied by the Ollama client). */
interface Completer {
  complete(prompt: string, opts?: { images?: string[]; format?: unknown }): Promise<unknown>;
}

const EMPTY: Enrichment = { description: '', tags: [] };

/** JSON schema constraining the model to a description + tag list. */
const SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  },
  required: ['description', 'tags']
};

/** Coerce an unknown model result into a safe Enrichment. */
function coerce(value: unknown): Enrichment {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const v = value as { description?: unknown; tags?: unknown };
  return {
    description: typeof v.description === 'string' ? v.description : '',
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : []
  };
}

/** Describe an image: returns a description + tags, or an empty Enrichment on failure. */
export async function enrichImage(ollama: Completer, bytes: Uint8Array): Promise<Enrichment> {
  try {
    const result = await ollama.complete(
      'Describe this image in one concise, factual paragraph, then give 3-6 ' +
        'short lowercase topic tags. Respond as JSON.',
      { images: [Buffer.from(bytes).toString('base64')], format: SCHEMA }
    );
    return coerce(result);
  } catch {
    return EMPTY;
  }
}

/** Summarise a web page: returns a description + tags, or an empty Enrichment on failure. */
export async function enrichUrl(
  ollama: Completer,
  fetcher: Fetcher,
  url: string
): Promise<Enrichment> {
  let text: string;
  try {
    text = extractText(await fetcher(url));
  } catch {
    return EMPTY;
  }
  if (!text) return EMPTY;
  try {
    const result = await ollama.complete(
      'Summarise the following web page in one concise paragraph, then give ' +
        `3-6 short lowercase topic tags. Respond as JSON.\n\nPage:\n${text}`,
      { format: SCHEMA }
    );
    return coerce(result);
  } catch {
    return EMPTY;
  }
}
