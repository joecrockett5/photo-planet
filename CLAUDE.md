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
Dockerfile, docker-compose.yml   single-container deploy, state in /data volume
```

npm workspaces: run everything from the repo root.

## Commands

```bash
npm install          # install all workspaces
npm run dev          # server on :3000 (tsx watch) + Vite on :5173 (proxies /api and /media to :3000)
npm run build        # build web then server
npm start            # run the built app on :3000 (serves web/dist)
npm run check        # typecheck + tests for all workspaces; must pass before committing
docker compose up --build   # full production-like run on :8080
```

In dev the server stores data in `./data` (git-ignored); in Docker it uses `/data`.

## System dependencies

The server shells out to `ffmpeg`/`ffprobe` (video metadata, posters, transcodes)
and `heif-convert` (HEIC → JPEG). They're installed in the Docker image. For
local dev without them, the code should degrade gracefully (log a warning, mark
the derived file as missing) rather than crash. In a fresh Linux sandbox:
`apt-get install -y ffmpeg libheif-examples`.

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
- If Docker is available, `docker compose up --build` and hit
  `http://localhost:8080/api/health`. If Docker is not available in your
  environment, say so; CI (`.github/workflows/ci.yml`) builds the image on every push.
