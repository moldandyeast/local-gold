import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';
import { captureScreenshot } from '../src/main/screenshot';

describe('captureScreenshot', () => {
  it('returns the PNG bytes when the spawn writes a file', async () => {
    const fakeSpawn = async (_cmd: string, args: string[]): Promise<void> => {
      const path = args[args.length - 1];
      writeFileSync(path, new Uint8Array([1, 2, 3, 4]));
    };
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result!)).toEqual([1, 2, 3, 4]);
  });

  it('returns null when the spawn writes no file (user cancelled)', async () => {
    const fakeSpawn = async (): Promise<void> => undefined;
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeNull();
  });

  it('returns null when the spawn throws', async () => {
    const fakeSpawn = async (): Promise<void> => {
      throw new Error('no such command');
    };
    const result = await captureScreenshot(fakeSpawn);
    expect(result).toBeNull();
  });
});
