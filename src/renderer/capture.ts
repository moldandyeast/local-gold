/** Render the capture view into `host`. */
export function renderCapture(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Capture</h2>
    <textarea id="body" placeholder="Write an insight…"></textarea>
    <input id="tags" type="text" placeholder="tags, comma, separated" />
    <div class="thumbs" id="thumbs"></div>
    <p class="hint">Paste an image to attach it.</p>
    <button class="primary" id="save">Save card</button>
    <span id="status" class="hint"></span>
  `;

  const body = host.querySelector<HTMLTextAreaElement>('#body')!;
  const tags = host.querySelector<HTMLInputElement>('#tags')!;
  const thumbs = host.querySelector<HTMLDivElement>('#thumbs')!;
  const status = host.querySelector<HTMLSpanElement>('#status')!;
  const images: { name: string; data: Uint8Array }[] = [];

  body.addEventListener('paste', async (e) => {
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      const name = file.name || `pasted.${item.type.split('/')[1] || 'png'}`;
      images.push({ name, data });
      const img = document.createElement('img');
      img.src = URL.createObjectURL(file);
      thumbs.appendChild(img);
    }
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
    await window.localgold.createCard({ body: text, tags: tagList, images });
    body.value = '';
    tags.value = '';
    images.length = 0;
    thumbs.innerHTML = '';
    status.textContent = 'Saved.';
    status.className = 'ok';
  });
}
