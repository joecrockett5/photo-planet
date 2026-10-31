# Photo Planet

Upload photos and videos; each one is pinned where it was taken on a little
pixel-art Earth you can spin around under a pixel-art starry sky. Tap a pin to
see what was taken there.

Self-hosted, one Docker container, all data in one volume. Made as a gift.

- **Upload** with the tiny `+` (or drag and drop onto the page). JPEG, PNG,
  HEIC/HEIF, WebP, MP4, MOV and WebM. Originals are stored untouched.
- **Location and date** come from the files themselves (EXIF for photos, the
  QuickTime/MP4 location tags phones write for videos).
- **No location?** The item waits in the "unplaced" tray until you open it,
  choose *place* and tap the spot on the planet. You can *move*, *unplace* or
  *delete* anything from the viewer.
- **Private** behind one shared password, if you set one.

See [docs/SPEC.md](docs/SPEC.md) for the full design.

## Run it

```bash
cp .env.example .env    # then edit: set APP_PASSWORD, SESSION_SECRET, PLANET_TITLE
docker compose up -d --build
```

Open <http://localhost:8080> (or whatever `HOST_PORT` you chose).

Check it's alive with `curl http://localhost:8080/api/health` → `{"ok":true}`.

To update later: `git pull && docker compose up -d --build`. Your data lives in
the volume, so it survives rebuilds.

## Configuration

All settings are environment variables (put them in `.env` for docker compose).

| Variable | Default | |
|---|---|---|
| `APP_PASSWORD` | unset | Shared password. Unset means no login: only do that on a private network. |
| `SESSION_SECRET` | random per start | Signs the login cookie. Set it (e.g. `openssl rand -hex 32`) or everyone is logged out whenever the container restarts. |
| `PLANET_TITLE` | `Photo Planet` | Shown small in the corner and as the browser tab title. A name works nicely: `Sam & Alex`. |
| `MAX_UPLOAD_MB` | `500` | Per-file upload limit. |
| `HOST_PORT` | `8080` | Host port (docker compose only). |
| `PORT` | `3000` | Port inside the container. You rarely need to change this. |
| `DATA_DIR` | `/data` | Where everything is stored inside the container. |

Logins last about a year (400 days, the browser maximum). Changing
`APP_PASSWORD` logs everyone out.

## Your data

Everything is in the `photo-planet-data` volume, mounted at `/data`:

```
/data
├─ photo-planet.db       SQLite database (locations, dates, etc.)
├─ originals/<id>.<ext>  your uploads, byte-for-byte untouched
└─ derived/<id>/…        thumbnails and browser-friendly copies (re-creatable)
```

**Back it up** by copying that volume, for example:

```bash
docker run --rm -v photo-planet-data:/data -v "$PWD":/backup debian:bookworm-slim \
  tar czf /backup/photo-planet-backup.tgz -C /data .
```

(Stop the container first, or run SQLite's `.backup`, if you want a perfectly
consistent copy of the database while uploads are happening.)

## Putting it on the internet

Any host that runs Docker works (a VPS, a home server, a NAS, Fly.io, Railway…):

- Build and run the image, publish container port `3000`, mount a persistent
  volume at `/data`.
- Set `APP_PASSWORD` **and** `SESSION_SECRET`.
- Put it behind HTTPS. Phones are fussy about picking photos on plain-HTTP
  sites, and you don't want the password sent in the clear. The login cookie
  is marked `Secure` automatically when the request arrives over HTTPS
  (`X-Forwarded-Proto` from your proxy is trusted).
- Raise your reverse proxy's request size limit so big videos can upload, and
  give it a generous timeout. With Caddy that's automatic; nginx needs e.g.:

  ```nginx
  client_max_body_size 500m;
  proxy_read_timeout 600s;
  ```

A minimal Caddyfile:

```
photos.example.com {
  reverse_proxy localhost:8080
}
```

## How it handles media

- Thumbnails are 400px WebP. HEIC photos get a JPEG copy for browsers
  (via libheif's `heif-dec`/`heif-convert`, or a bundled WebAssembly libheif). Videos get a poster frame; MOV/HEVC videos get an
  H.264 MP4 copy so they play in every browser (iPhone HDR video is
  tone-mapped). MP4/WebM that already play are served as-is, with seeking.
- Processing runs in the background, one file at a time; the pin appears as
  soon as the upload finishes and the thumbnail follows a moment later.
- Uploading the exact same file twice just points at the existing one.
- If a file couldn't be processed, the viewer says why, and it's retried
  automatically the next time the app starts (e.g. after an update).
- Place names ("Osaka, Japan") are worked out offline from bundled GeoNames
  and Natural Earth data. Nothing is sent to any third-party service, and the page loads
  no external fonts, scripts or maps.

## Development

Requires Node 22+. Video support needs `ffmpeg` (Debian/Ubuntu:
`apt-get install ffmpeg`; macOS: `brew install ffmpeg`); without it videos
upload and get pinned but have no thumbnail. HEIC works out of the box via a
bundled WebAssembly decoder; installing libheif's `heif-dec`/`heif-convert`
(`libheif-examples`, plus `libheif-plugin-libde265` on Ubuntu 24.04+/Debian
trixie+; `brew install libheif` on macOS) makes it faster.

```bash
npm install
npm run dev     # http://localhost:5173 (server on :3000, data in server/data)
npm run check   # typecheck + tests (server and web)
npm run build && npm start   # production build on :3000
```

Pass the same env vars to try the login and title locally, e.g.
`APP_PASSWORD=stardust PLANET_TITLE="Our Planet" npm run dev`.

The planet's geography is generated from the `world-atlas` package by
`npm run earth -w web`, the icons by `npm run icons -w web`, and the place-name
data by `npm run places -w server` (instructions at the top of
`server/scripts/make-places.ts`); the outputs are committed, so you only need
these if you change them.

## Credits

Geography: [Natural Earth](https://www.naturalearthdata.com/) (public domain),
via [world-atlas](https://github.com/topojson/world-atlas).
Place names: [GeoNames](https://www.geonames.org/) (CC BY 4.0).
Pixel font: [Silkscreen](https://kottke.org/plus/type/silkscreen/) by Jason
Kottke (SIL Open Font License), via Fontsource.
