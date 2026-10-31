# Photo Planet

Upload photos and videos; they get pinned to where they were taken on a little
pixel-art planet you can spin around under a pixel-art starry sky.

Self-hosted, single Docker container, all data in one volume.

> Status: early scaffold. See [docs/SPEC.md](docs/SPEC.md) for the plan and progress.

## Run it

```bash
cp .env.example .env   # optional: set APP_PASSWORD, SESSION_SECRET, PLANET_TITLE
docker compose up -d --build
```

Then open <http://localhost:8080>.

Everything (database, originals, thumbnails) is stored in the `photo-planet-data`
Docker volume. Back that up and you've backed up the planet.

### Deploying somewhere else

Any host that runs Docker works (a VPS, a home server, Fly.io, Railway, etc.):

- Build and run the image, publish container port `3000`.
- Mount a persistent volume at `/data`.
- Set `APP_PASSWORD` and `SESSION_SECRET` if it's reachable from the internet.
- Put it behind HTTPS (e.g. Caddy or your platform's TLS). Phones won't let you
  pick photos nicely from plain HTTP sites, and you don't want the password sent in the clear.

If you put a reverse proxy in front, raise its request body limit so large
videos can upload (e.g. `client_max_body_size 500m;` in nginx).

## Configuration

| Variable | Default | |
|---|---|---|
| `APP_PASSWORD` | unset | Shared password. Unset means no login. |
| `SESSION_SECRET` | random | Cookie signing key; set it so logins survive restarts. |
| `PLANET_TITLE` | `Photo Planet` | Shown in the corner and browser tab. |
| `MAX_UPLOAD_MB` | `500` | Per-file upload limit. |
| `HOST_PORT` | `8080` | Host port (docker compose only). |

## Development

Requires Node 22+. `ffmpeg` and `heif-convert` are needed for video and HEIC support.

```bash
npm install
npm run dev     # http://localhost:5173
npm run check   # typecheck + tests
```
