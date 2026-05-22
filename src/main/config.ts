import { readFileSync } from 'fs';
import { join } from 'path';

/** LocalGold runtime configuration. */
export interface Config {
  ollamaUrl: string;
  embedModel: string;
}

const DEFAULTS: Config = {
  ollamaUrl: 'http://localhost:11434',
  embedModel: 'embeddinggemma'
};

/** Read `config.json` from the LocalGold root, falling back to defaults. */
export function loadConfig(root: string): Config {
  let parsed: Partial<Config> = {};
  try {
    parsed = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Partial<Config>;
  } catch {
    parsed = {};
  }
  return {
    ollamaUrl: typeof parsed.ollamaUrl === 'string' ? parsed.ollamaUrl : DEFAULTS.ollamaUrl,
    embedModel: typeof parsed.embedModel === 'string' ? parsed.embedModel : DEFAULTS.embedModel
  };
}
