import '@fontsource/silkscreen/400.css';
import './style.css';
import { api, uploadFile } from './api';
import { applyPaletteToCss } from './render/palette';
import { Scene } from './scene';

applyPaletteToCss();
const scene = new Scene(document.querySelector<HTMLCanvasElement>('#sky')!);
Object.assign(window, { scene });

// Bare-bones upload until the real UI lands.
const status = document.createElement('div');
status.id = 'status';
const button = document.createElement('button');
button.textContent = '+';
button.id = 'upload';
const input = document.createElement('input');
input.type = 'file';
input.multiple = true;
input.accept = 'image/*,video/*,.heic,.heif,.mov';
input.hidden = true;
document.body.append(button, input, status);

async function refresh() {
  const items = await api.list();
  status.textContent = `${items.length} items`;
}
button.onclick = () => input.click();
input.onchange = async () => {
  const files = [...(input.files ?? [])];
  for (const [i, f] of files.entries()) {
    status.textContent = `${i + 1}/${files.length}`;
    await uploadFile(f, () => {});
  }
  input.value = '';
  await refresh();
};
refresh().catch(() => {});
api
  .config()
  .then((cfg) => (document.title = cfg.title))
  .catch(() => {});
