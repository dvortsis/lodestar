-- =============================================================================
-- LODESTAR / BITMAGNET PERFORMANCE & SEARCH OPTIMIZATION SUITE
-- Target: PostgreSQL 14+ 
-- Philosophy: PGroonga Bigram Indexing for Deep-File Discovery
-- =============================================================================

-- 1) Extensions
-- PGroonga is the backbone of Lodestar's discovery engine.
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- 2) Core Schema Enhancements (Main Torrents Table)
-- We add these columns to support the "Gold/Silver/Bronze" tiering and spam filtering.
ALTER TABLE torrents
  ADD COLUMN IF NOT EXISTS file_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_spam boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contained_extensions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS max_seeders integer NOT NULL DEFAULT 0,
  -- Custom Size Percentages for Advanced Filtering
  ADD COLUMN IF NOT EXISTS custom_video_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_audio_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_archive_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_app_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_doc_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_img_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_other_pct numeric DEFAULT 0;

-- 3) The PGroonga Sidecar Engine
-- This table stores a flattened string of all file paths within a torrent.
-- This allows "Gold Tier" searches (searching inside the torrent content).
CREATE TABLE IF NOT EXISTS torrent_search_indexes (
    info_hash bytea PRIMARY KEY REFERENCES torrents(info_hash) ON DELETE CASCADE,
    search_text text
);

-- 4) Generated Columns (Native Bitmagnet Composition)
-- These provide quick percentages based on Bitmagnet's internal file counts.
ALTER TABLE torrents 
  ADD COLUMN IF NOT EXISTS comp_video_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'video'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_audio_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'audio'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_archive_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'archive'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_app_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'app'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_document_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'document'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_image_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'image'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED,
  ADD COLUMN IF NOT EXISTS comp_other_count_pct numeric GENERATED ALWAYS AS ((COALESCE((file_stats->'other'->>'count')::numeric, 0) / NULLIF(files_count::numeric, 0) * 100.0)) STORED;

-- 5) Mapping Helpers
CREATE OR REPLACE FUNCTION get_custom_category(ext text) RETURNS text AS $$
BEGIN
    RETURN CASE
        WHEN LOWER(ext) IN ('mp4', 'mkv', 'avi', 'm4v', 'mov', 'wmv', 'flv', 'ts', 'm2ts') THEN 'video'
        WHEN LOWER(ext) IN ('mp3', 'flac', 'm4a', 'wav', 'ogg', 'opus', 'wma') THEN 'audio'
        WHEN LOWER(ext) IN ('zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'iso', 'bin') THEN 'archive'
        WHEN LOWER(ext) IN ('exe', 'msi', 'apk', 'app', 'dmg', 'sh', 'bat') THEN 'app'
        WHEN LOWER(ext) IN ('pdf', 'epub', 'mobi', 'doc', 'docx', 'txt', 'rtf', 'chm') THEN 'doc'
        WHEN LOWER(ext) IN ('jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff') THEN 'img'
        ELSE 'other'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6) Cleanup Legacy Bitmagnet Triggers
-- Real-time stats calculation kills DB performance during mass crawls.
-- Lodestar uses the 'janitor.js' script to handle this asynchronously.
DROP TRIGGER IF EXISTS tr_sync_all_stats ON torrent_files;
DROP FUNCTION IF EXISTS bm_sync_all_torrent_stats();

-- 7) Indexing Strategy (The Bigram Update)
-- We use TokenBigram to ensure partial matches and the | (OR) operator work
-- regardless of whether filenames use spaces, dots, or underscores.

-- 7a) Drop legacy trigram indexes to save space.
DROP INDEX IF EXISTS idx_torrents_name_trgm;
DROP INDEX IF EXISTS idx_torrent_files_path_trgm;

-- 7b) Primary Sidecar Search Index
DROP INDEX IF EXISTS ix_torrent_search_pgroonga;
CREATE INDEX ix_torrent_search_pgroonga 
ON torrent_search_indexes USING pgroonga (search_text) 
WITH (tokenizer='TokenBigram');

-- 7c) Main Torrents Table Search Index (Crucial for Tiering)
DROP INDEX IF EXISTS ix_torrents_name_pgroonga;
CREATE INDEX ix_torrents_name_pgroonga 
ON torrents USING pgroonga (name) 
WITH (tokenizer='TokenBigram');

-- 7d) UI Filter & Performance Indexes
CREATE INDEX IF NOT EXISTS idx_torrents_is_spam ON torrents (is_spam) WHERE is_spam = false;
CREATE INDEX IF NOT EXISTS idx_torrents_extensions_gin ON torrents USING GIN (contained_extensions);
CREATE INDEX IF NOT EXISTS idx_custom_video_pct ON torrents (custom_video_pct);
CREATE INDEX IF NOT EXISTS idx_torrent_files_preview ON torrent_files (info_hash, index) INCLUDE (path, size, extension);

-- 8) Statistics Update
ALTER TABLE torrents ALTER COLUMN name SET STATISTICS 1000;
ANALYZE torrents;
ANALYZE torrent_search_indexes;