-- =============================================================================
-- BITMAGNET PERFORMANCE & SEARCH OPTIMIZATION SUITE (SIDECAR EDITION)
-- Target: PostgreSQL 14+
-- Components: PGroonga Sidecar, Materialized Stats, Custom Categorization
-- =============================================================================

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS pgroonga;
-- We no longer use trigrams. You can drop the extension if no other apps use it.
-- DROP EXTENSION IF EXISTS pg_trgm CASCADE;

-- 2) Core Schema Enhancements (Main Torrents Table)
-- Keep this table lightweight. NO heavy text blobs here.
ALTER TABLE torrents
  ADD COLUMN IF NOT EXISTS file_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_spam boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS contained_extensions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS max_seeders integer NOT NULL DEFAULT 0,
  -- Custom Size Percentages (Based on our custom rules)
  ADD COLUMN IF NOT EXISTS custom_video_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_audio_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_archive_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_app_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_doc_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_img_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_other_pct numeric DEFAULT 0;

-- 3) The PGroonga Sidecar Engine
-- Isolates massive text data away from Bitmagnet's ORM crawler
CREATE TABLE IF NOT EXISTS torrent_search_indexes (
    info_hash bytea PRIMARY KEY REFERENCES torrents(info_hash) ON DELETE CASCADE,
    search_text text
);

-- 4) Generated Columns (Native Bitmagnet Composition - Count Based)
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

-- 6) Remove Dangerous Legacy Triggers
-- Real-time triggers cause write-locks and queue timeouts on massive multi-file torrents.
-- These metrics are now handled asynchronously by the external Janitor script.
DROP TRIGGER IF EXISTS tr_sync_all_stats ON torrent_files;
DROP FUNCTION IF EXISTS bm_sync_all_torrent_stats();

-- 7) Indexing Strategy
-- Drop legacy trigram indexes (reclaim SSD space)
DROP INDEX IF EXISTS idx_torrents_name_trgm;
DROP INDEX IF EXISTS idx_torrent_files_path_trgm;

-- Primary Search Index (PGroonga)
CREATE INDEX IF NOT EXISTS ix_torrent_search_pgroonga ON torrent_search_indexes USING pgroonga (search_text);

-- UI Filter Indexes
CREATE INDEX IF NOT EXISTS idx_torrents_is_spam ON torrents (is_spam) WHERE is_spam = false;
CREATE INDEX IF NOT EXISTS idx_torrents_extensions_gin ON torrents USING GIN (contained_extensions);
CREATE INDEX IF NOT EXISTS idx_custom_video_pct ON torrents (custom_video_pct);
CREATE INDEX IF NOT EXISTS idx_custom_archive_pct ON torrents (custom_archive_pct);
CREATE INDEX IF NOT EXISTS idx_torrent_files_preview ON torrent_files (info_hash, index) INCLUDE (path, size, extension);

-- Provide query planner with better statistics
ALTER TABLE torrents ALTER COLUMN name SET STATISTICS 1000;
ANALYZE torrents;
ANALYZE torrent_search_indexes;

-- =============================================================================
-- 8) Asynchronous Backfill / Janitor Queries (Reference Only)
-- =============================================================================
/*
These queries should be run periodically (e.g., via Unraid User Scripts every 15 mins)
to update the sidecar table and calculate metadata without blocking the crawler.

-- A) Update Max Seeders
UPDATE torrents t
SET max_seeders = s.m_seeders
FROM (
    SELECT info_hash, COALESCE(MAX(seeders), 0) as m_seeders 
    FROM torrents_torrent_sources 
    GROUP BY info_hash
) s
WHERE t.info_hash = s.info_hash 
  AND t.max_seeders IS DISTINCT FROM s.m_seeders;

-- B) Update Spam, Extensions, and Custom Percentages
UPDATE torrents t
SET 
    is_spam = (EXISTS (SELECT 1 FROM torrent_contents tc WHERE tc.info_hash = t.info_hash AND tc.content_type IN ('movie', 'tv_show') AND t.size < 314572800) OR (COALESCE(t.files_count, 0) > 500 AND t.size < 10485760)),
    contained_extensions = ARRAY(SELECT DISTINCT LOWER(extension) FROM torrent_files WHERE info_hash = t.info_hash AND extension IS NOT NULL),
    custom_video_pct = COALESCE((SELECT SUM(size) FROM torrent_files WHERE info_hash = t.info_hash AND get_custom_category(extension) = 'video'), 0) / NULLIF(t.size, 0) * 100.0,
    custom_archive_pct = COALESCE((SELECT SUM(size) FROM torrent_files WHERE info_hash = t.info_hash AND get_custom_category(extension) = 'archive'), 0) / NULLIF(t.size, 0) * 100.0,
    custom_app_pct = COALESCE((SELECT SUM(size) FROM torrent_files WHERE info_hash = t.info_hash AND get_custom_category(extension) = 'app'), 0) / NULLIF(t.size, 0) * 100.0
WHERE t.contained_extensions = '{}'; -- Only calculate for new torrents

-- C) Populate the PGroonga Sidecar Table
INSERT INTO torrent_search_indexes (info_hash, search_text)
SELECT t.info_hash, t.name || ' ' || COALESCE((
    SELECT string_agg(tf.path, ' ')
    FROM torrent_files tf
    WHERE tf.info_hash = t.info_hash
), '')
FROM torrents t
LEFT JOIN torrent_search_indexes tsi ON t.info_hash = tsi.info_hash
WHERE tsi.info_hash IS NULL
ON CONFLICT (info_hash) DO UPDATE 
SET search_text = EXCLUDED.search_text;
*/