import { describe, it, expect } from 'vitest';
import { runTranscription } from '../src/main/transcribe';

const goodTranscriber = {
  transcribe: async () => 'hello world'
};
const throwingTranscriber = {
  transcribe: async () => {
    throw new Error('whisper down');
  }
};

describe('runTranscription', () => {
  it('returns the transcribed text from the backend', async () => {
    expect(await runTranscription(goodTranscriber, new Float32Array(8), 16000)).toBe('hello world');
  });

  it('returns an empty string when the backend throws', async () => {
    expect(await runTranscription(throwingTranscriber, new Float32Array(8), 16000)).toBe('');
  });
});
