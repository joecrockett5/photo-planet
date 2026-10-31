-- Media items. Paths are relative to DATA_DIR.
CREATE TABLE media (
  id              TEXT PRIMARY KEY,
  original_name   TEXT NOT NULL,
  mime            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  size            INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  lat             REAL,
  lon             REAL,
  location_source TEXT CHECK (location_source IN ('exif', 'manual')),
  taken_at        TEXT,
  uploaded_at     TEXT NOT NULL,
  width           INTEGER,
  height          INTEGER,
  duration        REAL,
  status          TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error           TEXT,
  original_path   TEXT NOT NULL,
  thumb_path      TEXT,
  display_path    TEXT
);

CREATE INDEX media_sha256 ON media (sha256);
CREATE INDEX media_taken_at ON media (taken_at);
