import '@fontsource-variable/onest/index.css';
import { renderCapture } from './capture';
import { renderLibrary } from './library';
import { renderSettings } from './settings';

const view = document.getElementById('view')!;
const tabCapture = document.getElementById('tab-capture')!;
const tabLibrary = document.getElementById('tab-library')!;
const tabSettings = document.getElementById('tab-settings')!;

function selectTab(active: HTMLElement): void {
  for (const t of [tabCapture, tabLibrary, tabSettings]) t.classList.remove('active');
  active.classList.add('active');
}

tabCapture.addEventListener('click', () => {
  selectTab(tabCapture);
  renderCapture(view);
});

tabLibrary.addEventListener('click', () => {
  selectTab(tabLibrary);
  renderLibrary(view);
});

tabSettings.addEventListener('click', () => {
  selectTab(tabSettings);
  renderSettings(view);
});

renderCapture(view);
