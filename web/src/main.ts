import '@fontsource/silkscreen/400.css';
import './style.css';
import { api, auth, type MediaItem } from './api';
import { describeItems } from './format';
import { motion } from './motion';
import { unproject, type Cluster } from './planet/geo';
import { applyPaletteToCss } from './render/palette';
import type { PinHit, PlacedItem } from './render/pins';
import { Scene } from './scene';
import { store } from './store';
import { h } from './ui/dom';
import { icon } from './ui/icons';
import { Gallery } from './ui/gallery';
import { Login } from './ui/login';
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

// ---------------------------------------------------------------- clouds over photos

/** Whether the clouds part over places with photos. Remembered per device; on by default. */
const CLEAR_KEY = 'photo-planet:clear-clouds';
let clearClouds = (() => {
  try {
    return localStorage.getItem(CLEAR_KEY) !== 'off';
  } catch {
    return true;
  }
})();
const cloudButton = h('button.icon-button.cloud-toggle', { onclick: () => toggleClouds() }, icon('cloud'));
function renderCloudButton() {
  cloudButton.setAttribute('aria-pressed', String(clearClouds));
  const label = clearClouds ? 'Clouds part over your photos (tap to keep them everywhere)' : 'Clouds everywhere (tap to clear them over your photos)';
  cloudButton.setAttribute('aria-label', label);
  cloudButton.title = label;
}
function applyClearings() {
  scene.setClearings(clearClouds ? store.placed : null);
}
function toggleClouds() {
  clearClouds = !clearClouds;
  try {
    localStorage.setItem(CLEAR_KEY, clearClouds ? 'on' : 'off');
  } catch {
    // private mode: just don't remember
  }
  renderCloudButton();
  applyClearings();
  toast.show(clearClouds ? 'Clouds part over your photos' : 'Clouds everywhere', undefined, 2500);
}
renderCloudButton();

// ---------------------------------------------------------------- reduce motion

const motionButton = h('button.icon-button.motion-toggle', { onclick: () => motion.set(!motion.reduced) }, icon('twinkle'));
function renderMotionButton() {
  motionButton.setAttribute('aria-pressed', String(motion.reduced));
  const label = motion.reduced
    ? 'Reduce motion is on: a still planet and sky (tap for twinkling stars and a slowly turning planet)'
    : 'Reduce motion is off (tap to keep the planet and sky still)';
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
}
motion.onChange((reduced) => {
  renderMotionButton();
  scene.invalidate();
  toast.show(reduced ? 'Reduce motion on: a still planet and sky' : 'Motion on: twinkling stars, drifting clouds, a turning planet', undefined, 2500);
});
renderMotionButton();
ui.append(h('div.corner-buttons', {}, motionButton, cloudButton));
const coarse = matchMedia('(pointer: coarse)').matches;
const emptyHint = h(
  'p.empty-hint',
  { hidden: true },
  coarse ? 'A quiet little planet. Tap + to add your first photo' : 'A quiet little planet. Drop a photo here, or press +',
);
ui.append(unplacedButton, emptyHint);

const gallery = new Gallery(ui);
const viewer = new Viewer(document.body);
const uploader = new Uploader(ui);
const placing = new Placing(ui);
const toast = new Toast(ui);
const login = new Login(document.body);

// ---------------------------------------------------------------- data → scene

store.subscribe((items) => {
  // re-cluster pins and re-clear clouds only if something actually moved
  if (scene.pins.setItems(store.placed)) applyClearings();
  const unplaced = store.unplaced.length;
  unplacedButton.hidden = unplaced === 0;
  unplacedButton.textContent = `${unplaced} unplaced`;
  if (placing.active && placing.items.some((i) => !store.get(i.id))) placing.cancel();
  emptyHint.hidden = items.length > 0;
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
gallery.onPlace = (items) => startPlacing(items);
gallery.onDelete = (items) => void removeMany(items);

scene.onTap = (x, y) => {
  if (placing.active) return void placeAt(x, y);
  const hit = scene.pins.hitTest(x, y, slop());
  if (hit) openCluster(hit.cluster);
  else if (gallery.isOpen) gallery.close();
};

// ---------------------------------------------------------------- placing and editing

function startPlacing(items: MediaItem[]) {
  if (!items.length) return;
  viewer.close();
  gallery.close();
  placing.start(items);
  // a single item being moved: start from where it is now
  const first = items[0]!;
  if (items.length === 1 && first.lat !== null && first.lon !== null) scene.control.flyTo(first.lat, first.lon);
}

placing.onChange = (items) => {
  if (!items) scene.setOffset(0, 0);
  scene.pins.ghost = null;
  scene.control.idleEnabled = !items;
  scene.px.canvas.style.cursor = items ? 'crosshair' : '';
  scene.invalidate();
};

// Keep the planet's centre (where a previewed town turns to) clear of the panel.
placing.onResize = (bottom) => {
  scene.setOffset(0, bottom / 2 / scene.px.cssPx);
};

// Moving through suggestions previews them: the planet turns there and a pin blinks.
placing.onPreview = (match) => {
  scene.pins.ghost = match ? { lat: match.lat, lon: match.lon } : null;
  if (match) scene.control.flyTo(match.lat, match.lon, Math.max(scene.control.zoom, 1.6), 0.6);
  scene.invalidate();
};
placing.onChoose = (match) => {
  scene.control.flyTo(match.lat, match.lon, Math.max(scene.control.zoom, 1.6), 0.6);
  void placeItems(match.lat, match.lon);
};

/** Tap on the planet while placing. */
function placeAt(x: number, y: number) {
  const spot = unproject(scene.view, x, y);
  if (spot) void placeItems(spot.lat, spot.lon);
}

async function placeItems(lat: number, lon: number) {
  const items = placing.items;
  if (!items.length) return;
  const before = items.map((i) => ({ id: i.id, lat: i.lat, lon: i.lon }));
  placing.cancel();
  try {
    const placed = await api.setLocations(items.map((i) => i.id), lat, lon);
    store.upsert(...placed);
    const place = placeName(placed);
    const what = placed.length === 1 ? 'Placed' : `Placed ${placed.length}`;
    toast.show(place ? `${what} in ${place}` : what, { label: 'undo', run: () => void restore(before) });
  } catch (err) {
    toast.show(`Couldn't place ${items.length === 1 ? 'it' : 'them'}: ${(err as Error).message}`);
  }
}

/** Put items back where they were (undo). Groups by old location: usually all unplaced. */
async function restore(before: { id: string; lat: number | null; lon: number | null }[]) {
  const groups = new Map<string, typeof before>();
  for (const b of before) {
    const key = `${b.lat},${b.lon}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  try {
    for (const group of groups.values()) {
      const { lat, lon } = group[0]!;
      store.upsert(...(await api.setLocations(group.map((b) => b.id), lat, lon)));
    }
  } catch (err) {
    toast.show(`Couldn't undo: ${(err as Error).message}`);
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

async function removeMany(items: MediaItem[]) {
  try {
    const { deleted } = await api.removeMany(items.map((i) => i.id));
    store.remove(...items.map((i) => i.id));
    toast.show(deleted === 1 ? 'Deleted' : `Deleted ${deleted}`);
  } catch (err) {
    toast.show(`Couldn't delete them: ${(err as Error).message}`);
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
    ? { label: 'place', icon: 'pin', run: (i) => startPlacing([i]) }
    : { label: 'move', icon: 'pin', run: (i) => startPlacing([i]) },
  ...(item.lat !== null ? [{ label: 'unplace', icon: 'unpin' as const, run: unplace }] : []),
  { label: 'delete', icon: 'trash', run: remove, confirm: 'sure?', danger: true },
];

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
  if (!hit || gallery.isOpen) {
    hoverLabel.hidden = true;
    return;
  }
  const items: MediaItem[] = hit.cluster.items;
  const place = placeName(items, 'short');
  hoverLabel.textContent = place ? `${place} · ${describeItems(items)}` : describeItems(items);
  hoverLabel.hidden = false;
  positionHoverLabel();
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
  if (e.key === 'Escape') {
    if (placing.active) placing.cancel();
    else if (gallery.isOpen) gallery.close();
    return;
  }
  // spin and zoom the planet from the keyboard when nothing else wants the keys
  if (login.isOpen || (e.target instanceof HTMLElement && e.target.closest('input, .gallery'))) return;
  const turn: Record<string, [number, number]> = {
    ArrowLeft: [0, -60],
    ArrowRight: [0, 60],
    ArrowUp: [40, 0],
    ArrowDown: [-40, 0],
  };
  if (turn[e.key]) {
    scene.control.nudge(...turn[e.key]!);
    e.preventDefault();
  } else if (e.key === '+' || e.key === '=') scene.control.zoomBy(1.25);
  else if (e.key === '-' || e.key === '_') scene.control.zoomBy(0.8);
});


// ---------------------------------------------------------------- start

let appTitle = document.title;

async function requireLogin() {
  if (login.isOpen) return;
  viewer.close();
  gallery.close();
  placing.cancel();
  // lift the planet to make room for the form underneath
  scene.setOffset(0, -scene.px.height * 0.1);
  await login.show(appTitle);
  scene.setOffset(0, 0);
  await store.refresh();
}
auth.onUnauthorized = () => void requireLogin();

async function start() {
  const cfg = await api.config();
  appTitle = cfg.title;
  document.title = cfg.title;
  title.textContent = cfg.title;
  if (cfg.authRequired && !cfg.authenticated) await requireLogin();
  else await store.refresh();
  // open on the most recent memory
  const latest = [...store.placed].sort((a, b) => ((a.takenAt ?? a.uploadedAt) < (b.takenAt ?? b.uploadedAt) ? 1 : -1))[0];
  if (latest && scene.control.untouched) scene.control.flyTo(latest.lat, latest.lon, scene.control.zoom, 1.6);
}
start().catch((err) => {
  console.error(err);
  toast.show("Couldn't reach the planet. Is the server running?", undefined, 60_000);
});

Object.assign(window, { scene, store, viewer });
