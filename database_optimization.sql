-- =============================================================================
-- LODESTAR / BITMAGNET PERFORMANCE & SEARCH OPTIMIZATION SUITE
-- Target: PostgreSQL 14+ 
-- Philosophy: Decoupled Sidecar Architecture & PGroonga Bigram Indexing
-- =============================================================================

-- 1) Extensions
-- PGroonga is the backbone of Lodestar's discovery engine.
CREATE EXTENSION IF NOT EXISTS pgroonga;


-- 2) Database Cleanup (Pruning the Dead Weight)
-- Remove all legacy brute-force columns and generated percentages to 
-- prevent MVCC bloat and keep the main table lightning fast.
ALTER TABLE torrents 
  DROP COLUMN IF EXISTS contained_extensions,
  DROP COLUMN IF EXISTS custom_video_pct,
  DROP COLUMN IF EXISTS custom_audio_pct,
  DROP COLUMN IF EXISTS custom_archive_pct,
  DROP COLUMN IF EXISTS custom_app_pct,
  DROP COLUMN IF EXISTS custom_doc_pct,
  DROP COLUMN IF EXISTS custom_img_pct,
  DROP COLUMN IF EXISTS custom_other_pct,
  DROP COLUMN IF EXISTS comp_video_count_pct,
  DROP COLUMN IF EXISTS comp_audio_count_pct,
  DROP COLUMN IF EXISTS comp_archive_count_pct,
  DROP COLUMN IF EXISTS comp_app_count_pct,
  DROP COLUMN IF EXISTS comp_document_count_pct,
  DROP COLUMN IF EXISTS comp_image_count_pct,
  DROP COLUMN IF EXISTS comp_other_count_pct;


-- 3) Core Schema Enhancements (Main Torrents Table)
-- We only keep the absolute bare minimum required for top-level tiering/filtering.
ALTER TABLE torrents
  ADD COLUMN IF NOT EXISTS file_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_spam boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_seeders integer NOT NULL DEFAULT 0;


-- 4) The Sidecar Engines (Decoupled Data)

-- Sidecar A: Text Discovery
-- Stores a flattened string of all file paths to allow "Gold Tier" deep searches.
CREATE TABLE IF NOT EXISTS torrent_search_indexes (
    info_hash bytea PRIMARY KEY REFERENCES torrents(info_hash) ON DELETE CASCADE,
    search_text text
);

-- Sidecar B: Payload Composition
-- Highly optimized 1:1 table for frontend visualization and filtering by file counts.
CREATE TABLE IF NOT EXISTS torrent_compositions (
    info_hash bytea PRIMARY KEY REFERENCES torrents(info_hash) ON DELETE CASCADE,
    video_count integer NOT NULL DEFAULT 0,
    audio_count integer NOT NULL DEFAULT 0,
    image_count integer NOT NULL DEFAULT 0,
    document_count integer NOT NULL DEFAULT 0,
    archive_count integer NOT NULL DEFAULT 0,
    app_count integer NOT NULL DEFAULT 0,
    other_count integer NOT NULL DEFAULT 0
);


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

-- 7b) Primary Sidecar Search Index (PGroonga)
DROP INDEX IF EXISTS ix_torrent_search_pgroonga;
CREATE INDEX ix_torrent_search_pgroonga 
ON torrent_search_indexes USING pgroonga (search_text) 
WITH (tokenizer='TokenBigram');

-- 7c) Main Torrents Table Search Index (Crucial for Tiering)
DROP INDEX IF EXISTS ix_torrents_name_pgroonga;
CREATE INDEX ix_torrents_name_pgroonga 
ON torrents USING pgroonga (name) 
WITH (tokenizer='TokenBigram');

-- 7d) PostgreSQL FTS (websearch_to_tsquery) on sidecar text
-- Complements PGroonga for Lodestar keyword search
CREATE INDEX IF NOT EXISTS ix_torrent_search_fts_en
ON torrent_search_indexes USING gin (to_tsvector('english', search_text));

-- 7e) UI Filter & Performance Indexes
CREATE INDEX IF NOT EXISTS idx_torrents_is_spam ON torrents (is_spam) WHERE is_spam = false;
CREATE INDEX IF NOT EXISTS idx_torrent_files_preview ON torrent_files (info_hash, index) INCLUDE (path, size, extension);


-- 8) Statistics Update
-- Forces Postgres to analyze the new schema to build optimal query execution plans.
ALTER TABLE torrents ALTER COLUMN name SET STATISTICS 1000;
VACUUM ANALYZE torrents;
VACUUM ANALYZE torrent_search_indexes;
VACUUM ANALYZE torrent_compositions;