-- Near-duplicate detection (see src/media/dedupe.ts).
-- Fingerprint of the thumbnail: what the picture looks like.
ALTER TABLE media ADD COLUMN phash TEXT;
ALTER TABLE media ADD COLUMN color_sig TEXT;
-- EXIF SubSecTimeOriginal: tells burst shots taken in the same second apart.
ALTER TABLE media ADD COLUMN taken_subsec TEXT;
-- 1 until a new upload has been compared with the library. Items that were
-- already here are never merged with each other, only with new uploads.
ALTER TABLE media ADD COLUMN dedupe_pending INTEGER NOT NULL DEFAULT 0;

-- One row per copy removed as a duplicate. The removed copy's files sit in
-- trash/<removed_id>/ until purged (after 30 days, or when the kept item is
-- deleted), so the merge can be undone.
CREATE TABLE merges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- the new upload whose check found the duplicate (it may be the kept or the removed copy)
  upload_id   TEXT NOT NULL,
  kept_id     TEXT NOT NULL,
  removed_id  TEXT NOT NULL,
  -- the removed media row, as JSON (NULL once purged)
  removed_row TEXT,
  -- the kept item's location/date fields before and after the merge, as JSON
  kept_before TEXT NOT NULL,
  kept_after  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'undone', 'purged'))
);

CREATE INDEX merges_kept ON merges (kept_id);
CREATE INDEX merges_removed ON merges (removed_id);
CREATE INDEX merges_created ON merges (created_at);
