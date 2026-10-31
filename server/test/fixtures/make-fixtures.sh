#!/usr/bin/env bash
# Regenerates the tiny metadata fixtures in this directory. The outputs are
# committed, so you only need this if you want to change them.
# Needs: ffmpeg, exiftool (libimage-exiftool-perl), heif-enc with an HEVC encoder
# (libheif-examples + libheif-plugin-x265).
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# A 16x12 test image (a few colour bars so encoders have something to chew on).
ffmpeg -loglevel error -y -f lavfi -i "smptebars=size=16x12" -frames:v 1 "$tmp/base.png"
ffmpeg -loglevel error -y -i "$tmp/base.png" -q:v 5 "$tmp/base.jpg"

exif() { exiftool -q -overwrite_original "$@"; }

# JPEG, Lisbon (N, W), with a timezone offset.
cp "$tmp/base.jpg" photo-lisbon.jpg
exif -GPSLatitude=38.7223 -GPSLatitudeRef=N -GPSLongitude=9.1393 -GPSLongitudeRef=W \
  -DateTimeOriginal="2023:06:14 18:32:05" -OffsetTimeOriginal="+01:00" photo-lisbon.jpg

# PNG, Sydney (S, E), no offset.
cp "$tmp/base.png" photo-sydney.png
exif -GPSLatitude=33.8568 -GPSLatitudeRef=S -GPSLongitude=151.2153 -GPSLongitudeRef=E \
  -DateTimeOriginal="2019:12:31 23:59:58" photo-sydney.png

# WebP, Rio de Janeiro (S, W).
ffmpeg -loglevel error -y -i "$tmp/base.png" -c:v libwebp -quality 50 photo-rio.webp
exif -GPSLatitude=22.9519 -GPSLatitudeRef=S -GPSLongitude=43.2105 -GPSLongitudeRef=W \
  -DateTimeOriginal="2020:02:22 09:15:00" photo-rio.webp

# HEIC, Tokyo (N, E), like an iPhone photo.
cp "$tmp/base.jpg" "$tmp/tokyo.jpg"
exif -GPSLatitude=35.6586 -GPSLatitudeRef=N -GPSLongitude=139.7454 -GPSLongitudeRef=E \
  -DateTimeOriginal="2024:04:01 12:00:30" -OffsetTimeOriginal="+09:00" "$tmp/tokyo.jpg"
heif-enc -q 30 -o photo-tokyo.heic "$tmp/tokyo.jpg" >/dev/null
# heif-enc carries the EXIF over, but make sure.
exif -GPSLatitude=35.6586 -GPSLatitudeRef=N -GPSLongitude=139.7454 -GPSLongitudeRef=E \
  -DateTimeOriginal="2024:04:01 12:00:30" -OffsetTimeOriginal="+09:00" photo-tokyo.heic

# JPEG with a date but no GPS (goes to the unplaced tray).
cp "$tmp/base.jpg" photo-no-gps.jpg
exif -DateTimeOriginal="2018:08:08 08:08:08" photo-no-gps.jpg

# iPhone-style MOV (H.264): QuickTime keys with ISO 6709 location and a local creation date.
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=32x24:rate=5:duration=2" \
  -f lavfi -i "sine=frequency=440:duration=2" -shortest \
  -c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p -c:a aac -b:a 8k \
  -movflags use_metadata_tags \
  -metadata "com.apple.quicktime.location.ISO6709=+40.6892-074.0445+010.000/" \
  -metadata "com.apple.quicktime.creationdate=2022-07-04T21:15:00-0400" \
  -metadata "creation_time=2022-07-05T01:15:00.000000Z" \
  video-new-york.mov

# Android-style MP4: `location` (©xyz) in ISO 6709 and a UTC creation_time.
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=32x24:rate=5:duration=2" \
  -c:v libx264 -preset veryslow -crf 40 -pix_fmt yuv420p \
  -metadata "location=+48.8584+002.2945/" \
  -metadata "creation_time=2021-09-01T10:00:00.000000Z" \
  video-paris.mp4

# HEVC MP4 (needs a transcode for Chrome/Firefox): Cape Town (S, E).
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=32x24:rate=5:duration=2" \
  -c:v libx265 -x265-params log-level=error -crf 40 -pix_fmt yuv420p -tag:v hvc1 \
  -metadata "location=-33.9249+018.4241/" \
  video-cape-town-hevc.mp4

# WebM without location.
ffmpeg -loglevel error -y -f lavfi -i "testsrc=size=32x24:rate=5:duration=2" \
  -c:v libvpx -b:v 20k -metadata "creation_time=2020-01-01T00:00:00.000000Z" video-no-gps.webm

ls -la
