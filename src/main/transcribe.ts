/**
 * A speech-to-text backend.
 * `samples` is mono PCM at `sampleRate` Hz (Whisper expects 16000).
 */
export interface Transcriber {
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>;
}

/**
 * Run a `Transcriber`, swallowing any error and returning '' instead.
 * Lets callers treat transcription as best-effort.
 */
export async function runTranscription(
  transcriber: Transcriber,
  samples: Float32Array,
  sampleRate: number
): Promise<string> {
  try {
    return await transcriber.transcribe(samples, sampleRate);
  } catch {
    return '';
  }
}

/**
 * The concrete Whisper backend, lazy-loaded from `@huggingface/transformers`.
 * The pipeline (model + tokenizer + ONNX runtime) is created once and reused.
 * The model (~145MB) downloads to the user's transformers cache on first use,
 * then runs offline.
 */
let pipelinePromise: Promise<(audio: Float32Array, opts?: unknown) => Promise<unknown>> | null =
  null;

async function getPipeline(): Promise<
  (audio: Float32Array, opts?: unknown) => Promise<unknown>
> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const transformers = (await import('@huggingface/transformers')) as {
        env: { cacheDir: string; allowLocalModels: boolean };
        pipeline: (
          task: string,
          model: string
        ) => Promise<(audio: Float32Array, opts?: unknown) => Promise<unknown>>;
      };
      // In a packaged Electron app, the package lives inside app.asar (a single
      // file at the OS level), so transformers.js's default in-package cache
      // and `localModelPath` resolve to paths ONNX runtime cannot actually
      // open. Point at a real writable directory and always fetch over the
      // network (still cached after the first run).
      const { homedir } = await import('os');
      const { join } = await import('path');
      transformers.env.cacheDir = join(homedir(), '.cache', 'huggingface');
      transformers.env.allowLocalModels = false;
      return transformers.pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en');
    })();
  }
  return pipelinePromise;
}

/** Build the Whisper-based `Transcriber`. */
export function createWhisperTranscriber(): Transcriber {
  return {
    async transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
      const pipe = await getPipeline();
      const result = await pipe(samples, { sampling_rate: sampleRate });
      if (result && typeof result === 'object' && 'text' in result) {
        return String((result as { text: unknown }).text).trim();
      }
      return '';
    }
  };
}
