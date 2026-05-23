import type { Enrichment } from '../shared/types';
import { decodeToPCM16k } from './audio';
import { arrowhead, type Point, type Shape } from './shapes';

/** What `openAnnotator` returns on Done. */
export interface AnnotatorResult {
  /** Flattened PNG of image + drawn shapes. */
  image: Uint8Array;
  /** Voice note(s) recorded in the modal (0 or 1). */
  audios: { name: string; data: Uint8Array }[];
  /** Voice transcript to append under `## Voice` (empty if no voice). */
  voiceBody: string;
  /** Tags suggested from the voice transcript. */
  voiceTags: string[];
}

const STROKE = '#EC9494'; // --problem
const WIDTH = 3;
const ARROW_HEAD = 14;

/**
 * Mount a fullscreen annotation modal over `document.body`. Resolves with the
 * flattened PNG + any voice on Done, or `null` on Cancel.
 */
export function openAnnotator(imageBytes: Uint8Array): Promise<AnnotatorResult | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'annot-overlay';
    overlay.innerHTML = `
      <div class="annot-toolbar">
        <button class="tool active" data-tool="pen">Pen</button>
        <button class="tool" data-tool="arrow">Arrow</button>
        <button class="tool" data-tool="rect">Rect</button>
        <button class="tool" id="undo">Undo</button>
        <button class="tool" id="record">🎙 Record</button>
        <span id="annot-status" class="hint"></span>
        <span class="spacer"></span>
        <button class="secondary" id="cancel">Cancel</button>
        <button class="primary" id="done">Done</button>
      </div>
      <div class="annot-canvas-wrap">
        <canvas id="annot-canvas"></canvas>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector<HTMLCanvasElement>('#annot-canvas')!;
    const ctx = canvas.getContext('2d')!;
    const statusEl = overlay.querySelector<HTMLSpanElement>('#annot-status')!;
    const recordBtn = overlay.querySelector<HTMLButtonElement>('#record')!;

    let tool: Shape['tool'] = 'pen';
    const shapes: Shape[] = [];
    let drawing: Shape | null = null;
    const audios: AnnotatorResult['audios'] = [];
    let voiceBody = '';
    let voiceTags: string[] = [];
    let recorder: MediaRecorder | null = null;
    let recordChunks: Blob[] = [];

    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      render();
    };
    img.src = URL.createObjectURL(new Blob([imageBytes as BlobPart], { type: 'image/png' }));

    function render(): void {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of shapes) drawShape(s);
      if (drawing) drawShape(drawing);
    }

    function drawShape(s: Shape): void {
      if (s.tool === 'pen') {
        if (s.points.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i += 1) {
          ctx.lineTo(s.points[i].x, s.points[i].y);
        }
        ctx.stroke();
      } else if (s.tool === 'arrow') {
        const [a, b] = s.points;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const head = arrowhead(a, b, ARROW_HEAD);
        ctx.beginPath();
        ctx.moveTo(head.left.x, head.left.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(head.right.x, head.right.y);
        ctx.stroke();
      } else {
        const [a, b] = s.points;
        ctx.strokeRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y)
        );
      }
    }

    // Tool buttons
    overlay.querySelectorAll<HTMLButtonElement>('.tool[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tool = btn.dataset.tool as Shape['tool'];
        overlay
          .querySelectorAll<HTMLButtonElement>('.tool[data-tool]')
          .forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    overlay.querySelector<HTMLButtonElement>('#undo')!.addEventListener('click', () => {
      shapes.pop();
      render();
    });

    // Drawing on the canvas
    function toCanvas(e: PointerEvent): Point {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    }
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = toCanvas(e);
      drawing = tool === 'pen' ? { tool, points: [p] } : { tool, points: [p, p] };
      render();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toCanvas(e);
      if (drawing.tool === 'pen') drawing.points.push(p);
      else drawing.points[1] = p;
      render();
    });
    canvas.addEventListener('pointerup', () => {
      if (!drawing) return;
      shapes.push(drawing);
      drawing = null;
      render();
    });

    // Voice (mirrors Phase 8 capture flow; one take per modal)
    recordBtn.addEventListener('click', async () => {
      if (recorder) {
        recorder.stop();
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        statusEl.textContent = 'Microphone unavailable.';
        return;
      }
      recordChunks = [];
      const rec = new MediaRecorder(stream);
      rec.addEventListener('dataavailable', (e) => recordChunks.push(e.data));
      rec.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        recordBtn.textContent = '🎙 Re-record';
        const type = recordChunks[0]?.type || 'audio/webm';
        const blob = new Blob(recordChunks, { type });
        const data = new Uint8Array(await blob.arrayBuffer());
        // Replace any prior take.
        audios.length = 0;
        audios.push({ name: 'voice.webm', data });
        statusEl.textContent = 'Transcribing voice…';
        let transcript = '';
        try {
          const samples = await decodeToPCM16k(blob);
          transcript = await window.localgold.transcribe(samples, 16000);
        } catch {
          transcript = '';
        }
        if (!transcript) {
          voiceBody = '';
          voiceTags = [];
          statusEl.textContent = 'Transcription unavailable.';
          return;
        }
        voiceBody = transcript;
        statusEl.textContent = 'Tagging transcript…';
        const enr: Enrichment = await window.localgold.enrichText(transcript);
        voiceTags = enr.tags;
        statusEl.textContent = '';
      });
      rec.start();
      recorder = rec;
      recordBtn.textContent = '⏹ Stop';
    });

    overlay.querySelector<HTMLButtonElement>('#cancel')!.addEventListener('click', () => {
      cleanup();
      resolve(null);
    });

    overlay.querySelector<HTMLButtonElement>('#done')!.addEventListener('click', () => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          cleanup();
          resolve(null);
          return;
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        cleanup();
        resolve({ image: data, audios, voiceBody, voiceTags });
      }, 'image/png');
    });

    function cleanup(): void {
      if (recorder) recorder.stop();
      overlay.remove();
    }
  });
}
