import { renderCapture } from './capture';

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
  view.innerHTML = '<p class="hint">Library — added in Task 14.</p>';
});

renderCapture(view);
