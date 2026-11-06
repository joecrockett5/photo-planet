# Third-party notices

Photo Planet's own code is under the [MIT License](LICENSE). It bundles or
derives data from the following, under their own terms.

## Data

| What | Used for | License |
|---|---|---|
| [Natural Earth](https://www.naturalearthdata.com/) 1:10m land and lakes, 1:50m countries (via [world-atlas](https://github.com/topojson/world-atlas)) | The planet's map; country names when no town is near | Public domain |
| [GeoNames](https://www.geonames.org/) `cities1000` and `countryInfo` | Town names ("Osaka, Japan") | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): place names © GeoNames contributors |

## Fonts

| What | License |
|---|---|
| [Silkscreen](https://fonts.google.com/specimen/Silkscreen) by Jason Kottke, via [Fontsource](https://fontsource.org/) | [SIL Open Font License 1.1](https://openfontlicense.org/) |

## Libraries and tools in the image

| What | Used for | License |
|---|---|---|
| [libheif-js](https://github.com/catdad-experiments/libheif-js) (via [heic-decode](https://github.com/catdad-experiments/heic-decode)) | HEIC decoding fallback, used unmodified as a separate library | LGPL-3.0 (heic-decode: ISC) |
| [libheif](https://github.com/strukturag/libheif) `heif-convert` (Debian package) | HEIC → JPEG | LGPL-3.0 |
| [FFmpeg](https://ffmpeg.org/) (Debian package) | Video metadata, posters, transcodes | LGPL-2.1+ / GPL-2.0+ (Debian build) |
| [sharp](https://sharp.pixelplumbing.com/) / libvips | Thumbnails | Apache-2.0 / LGPL-3.0 |
| [Fastify](https://fastify.dev/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [exifr](https://github.com/MikeKovarik/exifr), [Vite](https://vite.dev/) and other npm dependencies | Server, database, metadata, build | MIT / Apache-2.0 / ISC (see each package) |

Run `npx license-checker --production` in a checkout for the full npm list.
