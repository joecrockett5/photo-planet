# Changelog

All notable changes to Photo Planet. Versions follow
[Semantic Versioning](https://semver.org/); each release is published as the
container image `ghcr.io/joecrockett5/photo-planet:<version>`.

## [Unreleased]

## [1.0.0] - 2026-11-06

The first release.

### Added

- **A pixel-art planet** with real Earth geography (Natural Earth 1:10m land,
  1,355 lakes, the Caspian), dithered day/night shading, drifting clouds and a
  twinkling starfield. Drag to spin with a Google-Earth-style fling; scroll or
  pinch to zoom toward the pointer, deep enough that towns ~20km apart get
  their own pins.
- **Uploads** of photos (JPEG, PNG, HEIC/HEIF, WebP) and videos (MP4, MOV,
  WebM) by button or drag and drop; originals are kept untouched and
  duplicates are recognised.
- **Automatic placement** from EXIF and phone video location tags, with
  offline town names ("Osaka, Japan") from GeoNames.
- **Pins and galleries**: nearby photos cluster by zoom; tap a pin to fly to it
  and browse by day; full-screen viewer with swipe, keys and video playback.
- **Unplaced tray**: place photos by tapping the planet or typing a town,
  several at once; bulk delete.
- **Uploads feed**: everything newest first, by the day it was uploaded.
- **Browser-friendly copies**: thumbnails, HEIC → JPEG (native or bundled
  WebAssembly decoder), MOV/HEVC → H.264 MP4 with HDR tone-mapping.
- **Privacy**: one shared password with long-lived signed sessions; nothing is
  sent to third-party services.
- **Comfort settings**: reduce motion (on by default) and clear skies over
  photos, remembered per device; works as a phone home-screen app.
- **One container** for linux/amd64 and linux/arm64, all state in one volume.

[Unreleased]: https://github.com/joecrockett5/photo-planet/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/joecrockett5/photo-planet/releases/tag/v1.0.0
