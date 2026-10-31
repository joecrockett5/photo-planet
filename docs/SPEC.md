# Photo Planet: product spec

## What it is

A small self-hosted web app, made as a gift. People upload photos and videos.
The app reads where each one was taken from its metadata and pins it on a
**pixel-art planet** that you can spin around, floating in a **pixel-art starry sky**.
Click a pin and you see the photos and videos taken there.

It should feel like a quiet, personal keepsake rather than a product: minimal
chrome, lots of space, the planet as the centrepiece.

## Users

- One owner (the gift recipient), maybe a partner or family. Small numbers of
  people, hundreds to a few thousand media files over time.
- They use phones as much as laptops, so touch and small screens matter.

## Core features (v1)

### 1. Upload
- Drag and drop onto the page (desktop), or a single small "+" button that opens
  the file picker (mobile allows choosing from the camera roll).
- Accept multiple files at once. Images: JPEG, PNG, HEIC/HEIF, WebP. Video: MP4, MOV (iPhone), WebM.
- Show quiet, minimal progress (e.g. a thin bar, or a pixel counter "3/12").
- Max upload size configurable (`MAX_UPLOAD_MB`, default 500).
- Store the original file untouched. Never re-encode the original.

### 2. Metadata extraction (server side)
- Photos: read EXIF GPS lat/lon and capture date (`exifr` handles JPEG, HEIC, PNG, WebP).
- Videos: read GPS and creation time with `ffprobe`. iPhone MOV stores it in
  `com.apple.quicktime.location.ISO6709` (e.g. `+51.5074-000.1278+011.000/`);
  Android MP4 often uses the `location` tag in the same ISO 6709 format.
- If there is no GPS, the item goes in an **"unplaced"** tray (see 5).
- Store: id, original filename, mime type, kind (photo/video), lat, lon,
  taken_at, uploaded_at, width, height, duration (video), file paths.

### 3. Derived files
- Thumbnail for every item (WebP, ~400px long edge) for the gallery and pins.
- A browser-viewable "display" version where the original won't play or show in
  browsers: HEIC → JPEG/WebP; non-MP4/WebM video → H.264 MP4 (only if needed; MOV
  with H.264/HEVC often plays in Safari but not in Chrome/Firefox, so transcode to H.264 MP4).
- Video thumbnails: a frame from ~1s in via `ffmpeg`.
- Do the processing in-process, one job at a time, so a large video doesn't block
  the HTTP server (a simple in-memory queue is fine; mark item status
  `processing` → `ready` / `failed`).
- Note: sharp's prebuilt libvips does **not** decode HEIC. HEIC → JPEG tries,
  in order: `heif-dec`/`heif-convert` (native libheif CLI), sharp (in case its
  libvips has HEVC), then libheif compiled to WebAssembly (`heic-decode`) in a
  worker thread, which needs no system packages. Then sharp for resizing.
- Items whose processing failed are retried once at every start-up (a newer
  version or newly installed tool may handle them), and the API exposes the
  failure reason as `error`.

### 4. The planet (the centrepiece)
- A sphere rendered at **low internal resolution** (e.g. 128 to 200px across) and
  scaled up with nearest-neighbour (`image-rendering: pixelated`) so every pixel
  is crisp and chunky. It must look like pixel art, not a smooth 3D globe.
- Real Earth geography so pins land in recognisable places: land vs ocean from
  Natural Earth data (e.g. the `world-atlas` npm package, rasterised once into a
  low-res equirectangular bitmap), coloured with a **small, limited palette**
  (roughly 8 to 16 colours): deep/shallow ocean, coast/beach, grass, forest,
  desert, ice/snow at the poles. Optional slow-moving pixel clouds.
- Simple lighting: a terminator/shading with ordered (Bayer) dithering between
  palette colours instead of smooth gradients. A thin pixel atmosphere rim is a nice touch.
- Interaction:
  - Drag (mouse or touch) to spin it on both axes, with inertia that eases out.
  - Slow idle auto-rotation when nobody is touching it.
  - Pinch / scroll to zoom within limits; zooming in raises the internal
    resolution a little so detail improves while staying pixelated.
- Pins:
  - A small pixel-art marker (e.g. 3 to 5 px tall in planet pixels, maybe a
    tiny blinking light or flag) at each location, only drawn on the visible hemisphere.
  - Nearby items cluster into one pin (cluster radius depends on zoom).
    A cluster can show a count on hover.
  - Click/tap a pin → the planet smoothly rotates to centre it and the gallery opens.
- Recommended implementation: a hand-written software renderer on a 2D canvas
  (for each output pixel, ray-cast against the sphere, convert to lat/lon,
  sample the palette texture, apply dithered lighting). It is cheap at this
  resolution, easy to keep pixel-perfect, and needs no 3D library.
  Three.js with a tiny render target and `NearestFilter` is an acceptable alternative.

### 5. Starry sky background
- Full-screen pixel-art star field at the same pixel scale as the planet.
- Several layers: tiny 1px stars, a few brighter 2 to 3px "plus" stars, gentle
  twinkling (palette swaps, not smooth alpha), maybe a faint pixel nebula or the
  occasional shooting star.
- Optional subtle parallax as the planet is rotated.
- Deterministic (seeded) so it looks the same each visit.

### 6. Gallery / viewer
- Opens over the planet as a minimal panel (bottom sheet on mobile, side panel
  or centred overlay on desktop). Planet stays visible and dimmed behind.
- Shows the place's items as a thumbnail grid, sorted by date, with the date
  shown small. Clicking opens a full-screen viewer: swipe/arrow keys to move,
  videos play inline with native controls, Esc/tap outside to close.
- Optional: reverse-geocoded place name ("Lisbon, Portugal"). Only if it can be
  done offline (e.g. a bundled cities dataset); don't depend on a paid API.

### 7. Unplaced tray
- Items without GPS sit in a small tray/counter ("4 unplaced").
- The user can place one by picking it and tapping a point on the planet.
  This sets lat/lon manually (flag `location_source = 'manual'`).

### 8. Basic management
- Delete an item (with a confirm). Removes the original and derived files.
- Edit/clear an item's location (re-place on the planet).

### 9. Access control
- It will be on the public internet, so protect it with a single shared password
  set by env var `APP_PASSWORD`. If unset, the app is open (for local use).
- A minimal pixel-styled login screen; on success set a signed, httpOnly,
  long-lived cookie (`SESSION_SECRET` env var). All `/api` and `/media` routes need it.

### 10. Personalisation
- `PLANET_TITLE` env var (default "Photo Planet") shown small and quiet in a
  corner and as the page title. Since it's a gift, this is the place for a name
  ("Our Planet", "Sam & Alex").

## Design direction

- **Minimalist.** Planet in the centre, stars behind, almost nothing else on
  screen: a tiny title, a tiny "+" upload button, a tiny unplaced counter. No
  navbars, no cards, no shadows, no gradients.
- **Pixel-consistent.** Use one pixel scale everywhere (e.g. 1 art pixel = 3 to 4 CSS
  px, adapted to screen size). UI icons are pixel art too. Use a pixel font for
  the little UI text (e.g. "Press Start 2P" or "Silkscreen", self-hosted in the
  bundle, not loaded from Google at runtime).
- **Palette.** Dark space background (near-black blue/purple, not pure black),
  a limited palette shared by planet, stars and UI accents.
- **Motion.** Slow and calm. Easing on rotation, stepped animation for
  twinkles and pins (pixel art moves in steps).
- Respect `prefers-reduced-motion` (no auto-rotation, no twinkling).

## Technical architecture

Single Docker container, one Node.js process.

```
web/      Vite + TypeScript (no framework needed; vanilla TS + canvas)
server/   Fastify + TypeScript, SQLite (better-sqlite3), sharp, exifr, ffmpeg/ffprobe
/data     the only state (mount as a volume)
  ├─ photo-planet.db        SQLite database
  ├─ originals/<id>.<ext>   untouched uploads
  └─ derived/<id>/…         thumbnails, display versions
```

- The server serves the built frontend as static files, the JSON API under
  `/api`, and media under `/media` (with HTTP range support so videos can seek).
- DB migrations: plain numbered SQL files applied at start-up.

### API sketch (adjust as needed)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness (exists already) |
| GET | `/api/config` | `{ title, authRequired, authenticated, maxUploadMb }` |
| POST | `/api/login` | `{ password }` → sets cookie |
| POST | `/api/logout` | clears the cookie |
| GET | `/api/media` | all items (id, kind, lat, lon, takenAt, thumbUrl, status…) |
| GET | `/api/media/:id` | one item |
| POST | `/api/media` | multipart upload, one or more files → `{ results: [{ name, item?, duplicate?, error? }] }` |
| PATCH | `/api/media/:id` | update `{ lat, lon }` |
| DELETE | `/api/media/:id` | delete item and files |
| GET | `/media/:id/thumb` | thumbnail |
| GET | `/media/:id/display` | browser-viewable version (or original) |
| GET | `/media/:id/original` | original (`?download` for an attachment) |

### Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `DATA_DIR` | `/data` | where DB and files live |
| `APP_PASSWORD` | unset | shared password; unset = no auth |
| `SESSION_SECRET` | random per start | cookie signing key (set it, or users get logged out on restart) |
| `PLANET_TITLE` | `Photo Planet` | title shown in UI |
| `MAX_UPLOAD_MB` | `500` | per-file upload limit |

## Milestones

Work through these in order. Each one should leave `main` working, building in
Docker, and with `npm run check` passing.

- [x] **M1 Storage and upload:** DB + migrations, upload endpoint, store
      originals, list endpoint. Bare-bones upload button in the UI.
- [x] **M2 Metadata:** EXIF GPS/date for photos, ffprobe for videos, unit
      tests against fixture files (generate small fixtures with known GPS; keep
      them tiny, under ~100KB each, in `server/test/fixtures`).
- [x] **M3 Derived files:** thumbnails, HEIC → JPEG, video poster + transcode
      when needed, background job queue, status field.
- [x] **M4 Starfield:** pixel-art sky, full-screen, crisp at any size/DPR.
- [x] **M5 Planet:** software-rendered pixel planet with real geography,
      palette, dithered lighting, drag/inertia/idle spin/zoom.
- [x] **M6 Pins and gallery:** pins from `/api/media`, clustering, click to
      centre and open gallery, full-screen viewer with video playback.
- [x] **M7 Unplaced tray and editing:** manual placement, delete.
- [x] **M8 Auth and personalisation:** `APP_PASSWORD`, login screen, `PLANET_TITLE`.
- [x] **M9 Polish:** mobile/touch pass, reduced motion, empty state (a lonely
      planet with a hint to add the first photo), loading states, favicon (a tiny
      pixel planet), README deploy docs checked end to end.

## Implementation notes and decisions

Things the build settled that the sections above leave open, or where it
deliberately differs. Revisit any of them freely.

- **Text pixel size.** Icons, borders, pins and the canvas all use one art-pixel
  scale (3–4 CSS px, an integer number of *device* pixels per art pixel at any
  DPR). UI *text* (Silkscreen) is drawn at half that scale, still whole device
  pixels so it stays crisp, because at full scale the "tiny" title would be
  ~20px tall.
- **Biomes are painted, not measured.** Land/ocean, coastlines and country
  borders are real Natural Earth 1:50m data. Biomes (desert, forest, ice, rock)
  are hand-placed regions with noisy edges plus latitude belts, the Andes
  traced along South America's Pacific coast, and shallow water from distance
  to land. There is no elevation or climate data. The map is a committed
  2048×1024 RLE file made by `web/scripts/make-earth.ts`.
- **Lighting** is a fixed key light from the upper left (not the real sun), so
  the dithered terminator stays still while the globe turns.
- **Place names** are offline and country-level only ("Portugal",
  "Portugal & Spain"), from a bundled country raster. No city names yet.
- **Duplicates.** Uploads are deduplicated by SHA-256; uploading the same
  file twice returns the existing item.
- **Display versions** are made only when needed: HEIC → JPEG; MOV with
  H.264(+AAC) is *remuxed* to MP4 (no quality loss, fast); everything else
  not universally playable (HEVC, ProRes…) is transcoded to H.264 MP4, capped
  at 1920px, with HDR (HLG/PQ) tone-mapped via zscale when available. Large
  JPEGs are served as originals (no resized "display" copy).
- **Dates** are stored as the wall-clock time where the photo was taken
  (with its offset when the file records one) and shown by that calendar day,
  so a photo never shifts a day because of the server's timezone.
- **Gallery** dims the planet (a flat CSS brightness step, no overlay) and
  slides it beside the panel; tapping the planet away from pins closes it,
  tapping another pin switches to it.
- **Placing** an unplaced item is done from the viewer (*place*), then one tap
  on the planet; an undo toast follows. The same flow re-places (*move*) an
  item; *unplace* sends it back to the tray.
- **Opening the app** turns the planet to the most recent memory.
- **Sessions** last 400 days (the browser maximum); the cookie value
  fingerprints `APP_PASSWORD`, so changing the password logs everyone out.
  Login attempts are limited to 10 per 10 minutes per IP.
- **HEIC without system tools:** the WebAssembly libheif fallback (LGPL-3.0,
  like the libheif the Docker image ships) makes HEIC work on any host, e.g.
  `npm run dev` on a Mac. Native tools are still preferred: faster, less memory.
- **Reduced motion** keeps drags fully live (direct manipulation) but drops the
  inertial glide after letting go, along with idle spin and twinkles.
- **Keyboard:** arrow keys spin, `+`/`-` zoom, Esc closes things, ←/→ in the viewer.

## Non-goals (v1)

- Multiple users/accounts, sharing links, comments, albums.
- Cloud storage backends (S3 etc.). Local volume only.
- Editing photos.
- Any paid third-party API.
