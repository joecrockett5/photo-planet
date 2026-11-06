# syntax=docker/dockerfile:1
# Photo Planet: one image, multi-arch (linux/amd64, linux/arm64).
# Published to ghcr.io/joecrockett5/photo-planet by .github/workflows/release.yml.

# ---- build: JS/TS only, so it runs on the build machine's own architecture ----
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 ships prebuilt binaries, but npm still invokes node-gyp on its
# binding.gyp (a no-op when a prebuild exists), which needs python3.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# ---- deps: production node_modules for the *target* architecture (sharp, better-sqlite3) ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libheif-examples \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    APP_VERSION=$APP_VERSION
LABEL org.opencontainers.image.title="Photo Planet" \
      org.opencontainers.image.description="Pin your photos and videos on a spinnable pixel-art planet. Self-hosted, one container." \
      org.opencontainers.image.source="https://github.com/joecrockett5/photo-planet" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version=$APP_VERSION
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
COPY --from=build /app/server/workers ./server/workers
COPY --from=build /app/server/geo ./server/geo
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
