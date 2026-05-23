import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

/** Spawn an external process to completion. Injectable for tests. */
export type Spawn = (cmd: string, args: string[]) => Promise<void>;

const defaultSpawn: Spawn = async (cmd, args) => {
  await execFileAsync(cmd, args);
};

/**
 * Run macOS `screencapture -i <tempfile>` and read the resulting PNG.
 * Returns `null` if the user cancelled (no file produced) or the spawn fails.
 */
export async function captureScreenshot(
  spawn: Spawn = defaultSpawn
): Promise<Uint8Array | null> {
  const path = join(tmpdir(), `lg-screenshot-${Date.now()}.png`);
  try {
    await spawn('screencapture', ['-i', path]);
  } catch {
    return null;
  }
  let buf: Buffer;
  try {
    buf = await readFile(path);
  } catch {
    return null;
  }
  await unlink(path).catch(() => undefined);
  return new Uint8Array(buf);
}
