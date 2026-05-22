import '@fontsource-variable/onest/index.css';
import { renderCapture } from './capture';
import { renderLibrary } from './library';

const view = document.getElementById('view')!;
const tabCapture = document.getElementById('tab-capture')!;
const tabLibrary = document.getElementById('tab-library')!;

function select(active: HTMLElement, other: HTMLElement): void {
  active.classList.add('active');
  other.classList.remove('active');
}

tabCapture.addEventListener('click', () => {
  select(tabCapture, tabLibrary);
  renderCapture(view);
});

tabLibrary.addEventListener('click', () => {
  select(tabLibrary, tabCapture);
  renderLibrary(view);
});

renderCapture(view);
