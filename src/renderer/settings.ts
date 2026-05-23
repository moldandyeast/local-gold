function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Render the settings view into `host`. */
export function renderSettings(host: HTMLElement): void {
  host.innerHTML = `
    <h2>Settings</h2>
    <div class="setting">
      <h3>Data folder</h3>
      <div id="data-folder" class="path"></div>
      <div id="fallback" class="problem"></div>
      <div class="row">
        <button class="secondary" id="pick-folder">Choose folder…</button>
        <button class="secondary" id="reveal">Reveal in Finder</button>
      </div>
      <div id="pending"></div>
    </div>
  `;

  const folderEl = host.querySelector<HTMLDivElement>('#data-folder')!;
  const fallbackEl = host.querySelector<HTMLDivElement>('#fallback')!;
  const pendingEl = host.querySelector<HTMLDivElement>('#pending')!;

  async function refresh(): Promise<void> {
    const [prefs, effective] = await Promise.all([
      window.localgold.getPreferences(),
      window.localgold.getEffectiveDataDir()
    ]);
    folderEl.textContent = effective;
    if (prefs.dataDir !== effective) {
      fallbackEl.textContent =
        `Saved preference is ${prefs.dataDir} but couldn't be used; ` +
        `falling back to ${effective}.`;
    } else {
      fallbackEl.textContent = '';
    }
  }

  host.querySelector<HTMLButtonElement>('#pick-folder')!.addEventListener('click', async () => {
    const picked = await window.localgold.pickFolder();
    if (!picked) return;
    const effective = await window.localgold.getEffectiveDataDir();
    if (picked === effective) return;
    await window.localgold.setPreferences({ dataDir: picked });
    pendingEl.innerHTML =
      `<p class="hint">Data folder will change to <code>${escapeHtml(picked)}</code> ` +
      `on restart.</p><button class="primary" id="restart">Restart now</button>`;
    pendingEl.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', () => {
      void window.localgold.restartApp();
    });
  });

  host.querySelector<HTMLButtonElement>('#reveal')!.addEventListener('click', async () => {
    const effective = await window.localgold.getEffectiveDataDir();
    await window.localgold.revealFolder(effective);
  });

  void refresh();
}
