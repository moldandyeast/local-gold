import type { Enrichment, NewCard } from '../shared/types';

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
  const images: NewCard['images'] = [];
  let lastEnrichedUrl = '';

  /** Append a `## heading` description to the body and merge tags. */
  function applyEnrichment(heading: string, enr: Enrichment): void {
    if (enr.description) {
      const prefix = body.value.trim() ? `${body.value.replace(/\s+$/, '')}\n\n` : '';
      body.value = `${prefix}## ${heading}\n${enr.description}`;
    }
    if (enr.tags.length > 0) {
      const current = tags.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      for (const tag of enr.tags) {
        if (!current.includes(tag)) current.push(tag);
      }
      tags.value = current.join(', ');
    }
  }

  /** Add an image to the pending set, show a thumbnail, and enrich it. */
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

  /** Enrich the URL if the checkbox is on and the URL is new. */
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
      url: urlValue || undefined
    });
    body.value = '';
    tags.value = '';
    url.value = '';
    images.length = 0;
    thumbs.innerHTML = '';
    enrichBox.checked = false;
    lastEnrichedUrl = '';
    enrichStatus.textContent = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
