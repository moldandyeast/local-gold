import type { Enrichment, NewCard } from '../shared/types';
import { decodeToPCM16k } from './audio';

/** Render the capture view into `host`. */
export function renderCapture(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Capture</h2>
    <textarea id="body" placeholder="Write an insight…"></textarea>
    <input id="tags" type="text" placeholder="tags, comma, separated" />
    <input id="url" type="text" placeholder="https://…  (optional)" />
    <div class="row">
      <input type="checkbox" id="enrich-url" />
      <label for="enrich-url">Summarise the linked page</label>
    </div>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <button class="secondary" id="pick">Choose images…</button>
      <span class="hint">or paste an image</span>
    </div>
    <div class="row">
      <button class="secondary record" id="record">🎙 Record</button>
      <span id="record-timer" class="hint"></span>
    </div>
    <button class="primary" id="save">Save card</button>
    <span id="status" class="hint"></span>
    <div id="enrich-status" class="hint"></div>
  `;

  const body = host.querySelector<HTMLTextAreaElement>('#body')!;
  const tags = host.querySelector<HTMLInputElement>('#tags')!;
  const url = host.querySelector<HTMLInputElement>('#url')!;
  const thumbs = host.querySelector<HTMLDivElement>('#thumbs')!;
  const status = host.querySelector<HTMLSpanElement>('#status')!;
  const enrichBox = host.querySelector<HTMLInputElement>('#enrich-url')!;
  const enrichStatus = host.querySelector<HTMLDivElement>('#enrich-status')!;
  const recordBtn = host.querySelector<HTMLButtonElement>('#record')!;
  const timerEl = host.querySelector<HTMLSpanElement>('#record-timer')!;

  const images: NewCard['images'] = [];
  const audios: NonNullable<NewCard['audios']> = [];
  let lastEnrichedUrl = '';
  let recorder: MediaRecorder | null = null;
  let recordStart = 0;
  let recordTimer: number | undefined;

  function applyEnrichment(heading: string, enr: Enrichment): void {
    if (enr.description) {
      const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
      body.value = `${prefix}## ${heading}\n${enr.description}`;
    }
    mergeTags(enr.tags);
  }

  function mergeTags(newTags: string[]): void {
    if (newTags.length === 0) return;
    const current = tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of newTags) if (!current.includes(t)) current.push(t);
    tags.value = current.join(', ');
  }

  function addImage(name: string, data: Uint8Array): void {
    images.push({ name, data });
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([data as BlobPart]));
    thumbs.appendChild(img);
    enrichStatus.textContent = 'Describing image…';
    void window.localgold.enrichImage(data).then((enr) => {
      applyEnrichment('Image', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
  }

  function addAudioChip(name: string): void {
    const chip = document.createElement('span');
    chip.className = 'audio-chip';
    chip.textContent = `🎙 ${name}`;
    thumbs.appendChild(chip);
  }

  function maybeEnrichUrl(): void {
    const value = url.value.trim();
    if (!enrichBox.checked || !value || value === lastEnrichedUrl) return;
    lastEnrichedUrl = value;
    enrichStatus.textContent = 'Reading the page…';
    void window.localgold.enrichUrl(value).then((enr) => {
      applyEnrichment('Link', enr);
      enrichStatus.textContent = enr.description ? '' : 'Enrichment unavailable.';
    });
  }

  async function processRecording(blob: Blob): Promise<void> {
    const data = new Uint8Array(await blob.arrayBuffer());
    const name = 'voice.webm';
    audios.push({ name, data });
    addAudioChip(name);
    enrichStatus.textContent = 'Transcribing voice…';
    let transcript = '';
    try {
      const samples = await decodeToPCM16k(blob);
      transcript = await window.localgold.transcribe(samples, 16000);
    } catch {
      transcript = '';
    }
    if (!transcript) {
      enrichStatus.textContent = 'Transcription unavailable.';
      return;
    }
    const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
    body.value = `${prefix}## Voice\n${transcript}`;
    enrichStatus.textContent = 'Tagging transcript…';
    const enr = await window.localgold.enrichText(transcript);
    mergeTags(enr.tags);
    enrichStatus.textContent = '';
  }

  async function startRecording(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      enrichStatus.textContent = 'Microphone unavailable.';
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.addEventListener('dataavailable', (e) => chunks.push(e.data));
    rec.addEventListener('stop', () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = chunks[0]?.type || 'audio/webm';
      void processRecording(new Blob(chunks, { type }));
    });
    rec.start();
    recorder = rec;
    recordBtn.textContent = '⏹ Stop';
    recordBtn.classList.add('recording');
    recordStart = Date.now();
    timerEl.textContent = '0:00';
    recordTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - recordStart) / 1000);
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
  }

  function stopRecording(): void {
    if (!recorder) return;
    recorder.stop();
    recorder = null;
    window.clearInterval(recordTimer);
    recordBtn.textContent = '🎙 Record';
    recordBtn.classList.remove('recording');
    timerEl.textContent = '';
  }

  enrichBox.addEventListener('change', maybeEnrichUrl);
  url.addEventListener('change', maybeEnrichUrl);

  body.addEventListener('paste', async (e) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      addImage(file.name || `pasted.${item.type.split('/')[1] || 'png'}`, data);
    }
  });

  host.querySelector<HTMLButtonElement>('#pick')!.addEventListener('click', async () => {
    const picked = await window.localgold.pickImages();
    for (const img of picked) addImage(img.name, img.data);
  });

  recordBtn.addEventListener('click', () => {
    if (recorder) stopRecording();
    else void startRecording();
  });

  host.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', async () => {
    const text = body.value.trim();
    if (!text) {
      status.textContent = 'Nothing to save.';
      status.className = 'hint';
      return;
    }
    const tagList = tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const urlValue = url.value.trim();
    await window.localgold.createCard({
      body: text,
      tags: tagList,
      images,
      audios,
      url: urlValue || undefined
    });
    body.value = '';
    tags.value = '';
    url.value = '';
    images.length = 0;
    audios.length = 0;
    thumbs.innerHTML = '';
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
