/**
 * Decode an audio Blob (any browser-supported format) into mono 16 kHz PCM,
 * the shape Whisper expects. Uses Web Audio in the renderer — runs at
 * decode-once cost, then off to the main process for transcription.
 */
export async function decodeToPCM16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(buffer.slice(0));
  } finally {
    void decodeCtx.close();
  }
  const target = 16000;
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * target),
    target
  );
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
