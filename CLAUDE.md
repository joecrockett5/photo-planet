# Photo Planet: notes for Claude

Self-hosted web app (a gift): upload photos/videos, pin them by GPS metadata on a
spinnable pixel-art planet over a pixel-art starry sky. Minimalist UI. Ships as
one Docker container.

**Read `docs/SPEC.md` first.** It is the source of truth for features, design
direction, architecture and the milestone checklist. Tick milestones off in
`docs/SPEC.md` as you finish them, and update the spec if you make a deliberate
design change.

## Layout

```
server/   Fastify + TypeScript API, serves the built frontend in production
web/      Vite + TypeScript frontend (vanilla TS + canvas, no UI framework)
docs/     SPEC.md
Dockerfile, docker-compose.yml   single-container deploy (multi-arch image on ghcr.io), state in /data volume
.github/workflows/  ci.yml (tests on PRs; on main: release if the version is new, else image smoke test), release.yml (called by ci.yml: ghcr + tag + GitHub Release)
```

npm workspaces: run everything from the repo root.

## Commands

```bash
npm install          # install all workspaces
npm run dev          # server on :3000 (tsx watch) + Vite on :5173 (proxies /api and /media to :3000)
npm run build        # build web then server
npm start            # run the built app on :3000 (serves web/dist)
npm run check        # typecheck + tests for all workspaces; must pass before committing
docker compose -f docker-compose.yml -f docker-compose.build.yml up --build   # build this checkout as the image, on :8080
# (plain `docker compose up` pulls the published release from ghcr.io)
npm run earth -w web -- <natural earth dir>  # regenerate the planet's geography (see script header)
npm run icons -w web # regenerate favicon/touch icon from the planet renderer
npm run places -w server -- <geonames dir>  # regenerate place-name data (see script header)
```

In dev the server stores data in `server/data` (git-ignored); in Docker it uses `/data`.
Pass `APP_PASSWORD=… PLANET_TITLE=…` to `npm run dev` to try login/title locally.

## Where things live

- `server/src/media/`: metadata (`metadata.ts`, `exif-blocks.ts`, `iso6709.ts`),
  derived files (`derive.ts`), the job queue, DB access (`repo.ts`).
- `server/src/geo/places.ts`: offline reverse geocoding (data in `server/geo/`).
- `server/src/auth.ts`: password + signed cookie. `server/migrations/*.sql`: schema.
- `web/src/render/`: pixel canvas, palette, stars, planet ray-caster, pins.
- `web/src/planet/`: sphere maths + clustering (`geo.ts`), motion (`control.ts`), map loading.
- `web/src/ui/`: DOM bits (gallery/tray, viewer, upload, login, toasts).
- `server/test/fixtures/make-fixtures.sh` regenerates the metadata fixtures.

## System dependencies

The server shells out to `ffmpeg`/`ffprobe` (video metadata, posters, transcodes)
and, when present, `heif-dec`/`heif-convert` (HEIC → JPEG; otherwise a bundled
WebAssembly libheif in `server/workers/heic-decode.mjs` takes over). They're
installed in the Docker image. For local dev without them, the code should
degrade gracefully (log a warning, mark the item failed with a reason) rather
than crash. In a fresh Linux sandbox:
`apt-get install -y ffmpeg libheif-examples` (on Ubuntu 24.04+/Debian trixie+ also
`libheif-plugin-libde265`, or heif-convert can't decode HEIC).

## Releases

Versioned images are published to `ghcr.io/joecrockett5/photo-planet` automatically
when a push to `main` carries a `package.json` version that has no `vX.Y.Z` tag yet
(see README "CI and releases"). To release: add a `## [X.Y.Z]` section to
`CHANGELOG.md` and bump `version` in all three `package.json` files (CI checks they
agree). Don't push tags by hand; CI creates them. Changes that shouldn't release can
merge without a bump (put notes under `## [Unreleased]`).

## Conventions

- TypeScript strict mode everywhere, ES modules.
- Keep dependencies few. Prefer small, well-known packages; no UI framework in `web/`.
- Server config comes only from env vars, read in one place (`server/src/config.ts`).
- All persistent state lives under `DATA_DIR`. Never write elsewhere at runtime.
- Never modify uploaded originals.
- Pixel art must stay crisp: render to a low-res canvas, upscale with integer
  scale + `image-rendering: pixelated`, and account for `devicePixelRatio`.
- Tests: Vitest. Put metadata-parsing tests next to fixtures in `server/test/`.
  Keep fixture files tiny.

## Verifying your work

- `npm run check` must pass.
- For UI work, run `npm run dev` and look at it in a browser (desktop and a
  ~375px-wide mobile viewport) before calling it done. Take screenshots if you can.
- If Docker is available, build with the compose command above and hit
  `http://localhost:8080/api/health`. If Docker is not available in your
  environment, say so; CI (`.github/workflows/ci.yml`) runs the tests on every pull
  request and also builds and smoke-tests the image on pushes to `main`.
