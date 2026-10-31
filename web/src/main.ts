// M1: bare-bones upload. The sky and planet arrive in M4/M5.
import { api, uploadFile } from './api';

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
