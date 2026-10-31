import '@fontsource/silkscreen/400.css';
import './style.css';
import { api, type MediaItem } from './api';
import { describeItems } from './format';
import { motion } from './motion';
import { unproject, type Cluster } from './planet/geo';
import { applyPaletteToCss } from './render/palette';
import type { PinHit, PlacedItem } from './render/pins';
import { Scene } from './scene';
import { store } from './store';
import { h } from './ui/dom';
import { Gallery } from './ui/gallery';
import { Placing } from './ui/placing';
import { Toast } from './ui/toast';
import { placeName } from './ui/place';
import { Uploader } from './ui/upload';
import { Viewer } from './ui/viewer';

applyPaletteToCss();
const scene = new Scene(document.querySelector<HTMLCanvasElement>('#sky')!);
const ui = h('div.ui');
document.body.append(ui);

const title = h('h1.title', {}, '');
const hoverLabel = h('div.pin-label', { hidden: true });
ui.append(title, hoverLabel);

const unplacedButton = h('button.text-button.unplaced', { hidden: true, onclick: () => openTray() });
ui.append(unplacedButton);

const gallery = new Gallery(ui);
const viewer = new Viewer(document.body);
const uploader = new Uploader(ui);
const placing = new Placing(ui);
const toast = new Toast(ui);

// ---------------------------------------------------------------- data → scene

store.subscribe((items) => {
  scene.pins.setItems(store.placed);
  const unplaced = store.unplaced.length;
  unplacedButton.hidden = unplaced === 0;
  unplacedButton.textContent = `${unplaced} unplaced`;
  if (placing.item && !store.get(placing.item.id)) placing.cancel();
  gallery.update(items);
  viewer.update(items);
  scene.invalidate();
});

// ---------------------------------------------------------------- pins

/** Art-px forgiveness around pins: about 12 CSS px, more for fingers. */
const slop = () => (matchMedia('(pointer: coarse)').matches ? 16 : 6) / scene.px.cssPx;

function openCluster(cluster: Cluster<PlacedItem>) {
  scene.pins.selected = new Set(cluster.items.map((i) => i.id));
  scene.control.idleEnabled = false;
  scene.control.flyTo(cluster.lat, cluster.lon);
  gallery.open(cluster.items);
  hoverLabel.hidden = true;
  document.body.classList.add('gallery-open');
  requestAnimationFrame(() => layoutForPanel());
}

/** Shift the planet so it sits in the space the panel leaves free. */
function layoutForPanel() {
  if (!gallery.isOpen) return scene.setOffset(0, 0);
  const rect = gallery.el.getBoundingClientRect();
  const wide = rect.height >= innerHeight - 1;
  const cssPx = scene.px.cssPx;
  scene.setOffset(wide ? -rect.width / 2 / cssPx : 0, wide ? 0 : -rect.height / 2 / cssPx);
}
addEventListener('resize', layoutForPanel);

function openTray() {
  placing.cancel();
  scene.pins.selected = null;
  gallery.openTray(store.items);
  document.body.classList.add('gallery-open');
  requestAnimationFrame(() => layoutForPanel());
}

gallery.onClose = () => {
  scene.pins.selected = null;
  scene.control.idleEnabled = true;
  scene.setOffset(0, 0);
  document.body.classList.remove('gallery-open');
};
gallery.onOpenItem = (items, index) => viewer.open(items, index);

scene.onTap = (x, y) => {
  if (placing.active) return void placeAt(x, y);
  const hit = scene.pins.hitTest(x, y, slop());
  if (hit) openCluster(hit.cluster);
  else if (gallery.isOpen) gallery.close();
};

// ---------------------------------------------------------------- placing and editing

function startPlacing(item: MediaItem) {
  viewer.close();
  gallery.close();
  placing.start(item);
  // show the item's current spot, if it has one, as a starting point
  if (item.lat !== null && item.lon !== null) scene.control.flyTo(item.lat, item.lon);
}

placing.onChange = (item) => {
  scene.pins.ghost = null;
  scene.control.idleEnabled = !item;
  scene.px.canvas.style.cursor = item ? 'crosshair' : '';
  scene.invalidate();
};

async function placeAt(x: number, y: number) {
  const item = placing.item;
  const spot = item && unproject(scene.view, x, y);
  if (!item || !spot) return;
  const before = { lat: item.lat, lon: item.lon };
  placing.cancel();
  try {
    store.upsert(await api.setLocation(item.id, spot.lat, spot.lon));
    const place = await placeName([spot]);
    toast.show(place ? `Placed in ${place}` : 'Placed', {
      label: 'undo',
      run: () => void api.setLocation(item.id, before.lat, before.lon).then((i) => store.upsert(i)),
    });
  } catch (err) {
    toast.show(`Couldn't place it: ${(err as Error).message}`);
  }
}

async function unplace(item: MediaItem) {
  try {
    store.upsert(await api.setLocation(item.id, null, null));
    toast.show('Moved to unplaced', {
      label: 'undo',
      run: () => void api.setLocation(item.id, item.lat, item.lon).then((i) => store.upsert(i)),
    });
  } catch (err) {
    toast.show(`Couldn't change it: ${(err as Error).message}`);
  }
}

async function remove(item: MediaItem) {
  try {
    await api.remove(item.id);
    store.remove(item.id);
    toast.show('Deleted');
  } catch (err) {
    toast.show(`Couldn't delete it: ${(err as Error).message}`);
  }
}

viewer.actionsFor = (item) => [
  item.lat === null
    ? { label: 'place', icon: 'pin', run: startPlacing }
    : { label: 'move', icon: 'pin', run: startPlacing },
  ...(item.lat !== null ? [{ label: 'unplace', icon: 'unpin' as const, run: unplace }] : []),
  { label: 'delete', icon: 'trash', run: remove, confirm: 'sure?', danger: true },
];

let hoverToken = 0;
scene.onHover = (x, y) => {
  if (placing.active) {
    scene.pins.ghost = x < 0 ? null : unproject(scene.view, x, y);
    scene.control.poke();
    return;
  }
  const hit = x < 0 ? null : scene.pins.hitTest(x, y, 2);
  if (hit?.cluster !== scene.pins.hovered?.cluster) {
    scene.pins.hovered = hit;
    scene.invalidate();
    showHoverLabel(hit);
  }
  scene.px.canvas.style.cursor = hit ? 'pointer' : '';
  if (hit) scene.control.poke();
};

function showHoverLabel(hit: PinHit | null) {
  const token = ++hoverToken;
  if (!hit || gallery.isOpen) {
    hoverLabel.hidden = true;
    return;
  }
  const items: MediaItem[] = hit.cluster.items;
  hoverLabel.textContent = describeItems(items);
  hoverLabel.hidden = false;
  positionHoverLabel();
  void placeName(items).then((place) => {
    if (token === hoverToken && place) hoverLabel.textContent = `${place} · ${describeItems(items)}`;
  });
}

function positionHoverLabel() {
  const hit = scene.pins.hovered;
  if (!hit || hoverLabel.hidden) return;
  // follow the pin as the planet turns, using this frame's position
  const live = scene.pins.hits.find((p) => p.cluster === hit.cluster);
  if (!live) {
    hoverLabel.hidden = true;
    return;
  }
  const p = scene.px.toClient(live.x + 0.5, live.y - live.h - 1);
  hoverLabel.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
}
scene.onFrame = positionHoverLabel;

// ---------------------------------------------------------------- uploads

uploader.onBatchDone = (added) => {
  // show where the newest photo landed
  const placed = added.filter((i) => i.lat !== null && i.lon !== null);
  const last = placed[placed.length - 1];
  if (last && !gallery.isOpen) scene.control.flyTo(last.lat!, last.lon!);
};

// ---------------------------------------------------------------- keys

addEventListener('keydown', (e) => {
  if (viewer.handleKey(e)) return e.preventDefault();
  if (e.key !== 'Escape') return;
  if (placing.active) placing.cancel();
  else if (gallery.isOpen) gallery.close();
});

void motion; // imported for its side effect of tracking prefers-reduced-motion

// ---------------------------------------------------------------- start

async function start() {
  const cfg = await api.config();
  document.title = cfg.title;
  title.textContent = cfg.title;
  await store.refresh();
}
start().catch((err) => console.error(err));

Object.assign(window, { scene, store });
