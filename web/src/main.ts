// Placeholder: a static pixel starfield and a flat pixel disc, just to prove the
// low-res canvas + pixelated upscale pipeline. Replace with the real starfield
// and planet renderer (see docs/SPEC.md, milestones M4 and M5).

const PIXEL = 4; // CSS px per art pixel

const canvas = document.querySelector<HTMLCanvasElement>('#sky')!;
const ctx = canvas.getContext('2d')!;

function draw() {
  const w = Math.ceil(innerWidth / PIXEL);
  const h = Math.ceil(innerHeight / PIXEL);
  canvas.width = w;
  canvas.height = h;

  ctx.fillStyle = '#0b0b1a';
  ctx.fillRect(0, 0, w, h);

  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#e8e8ff';
  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
  }

  const r = Math.floor(Math.min(w, h) * 0.3);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) {
        ctx.fillStyle = x + y < 0 ? '#3a7bd5' : '#24508f';
        ctx.fillRect(cx + x, cy + y, 1, 1);
      }
    }
  }
}

addEventListener('resize', draw);
draw();

fetch('/api/config')
  .then((res) => res.json())
  .then((cfg: { title: string }) => (document.title = cfg.title))
  .catch(() => {});
