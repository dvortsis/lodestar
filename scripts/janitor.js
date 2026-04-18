/**
 * Lodestar Search Janitor — Decoupled Sidecar Maintenance (BATCHED)
 * -------------------------------------------------------
 * Syncs the PGroonga text index and the Payload Compositions table.
 * Includes fallback logic to identify file types for single-file torrents.
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const { Client } = require('pg');

async function runJanitor() {
  console.log(`[${new Date().toISOString()}] 🧹 Starting Lodestar Janitor...`);

  const dbUrl = process.env.POSTGRES_DB_URL;
  if (!dbUrl) {
    console.error("❌ ERROR: POSTGRES_DB_URL is not set in your .env file.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: dbUrl,
  });

  try {
    await client.connect();
    console.log("✅ Connected to the database.");

    // ==========================================
    // PHASE 1: Sync Text Search Sidecar (Batched)
    // ==========================================
    console.log("⏳ [Phase 1] Indexing new torrent text...");
    let p1Processed = 0;
    
    while (true) {
      const indexQuery = `
        WITH batch AS (
          SELECT t.info_hash, t.name
          FROM torrents t
          LEFT JOIN torrent_search_indexes tsi ON t.info_hash = tsi.info_hash
          WHERE tsi.info_hash IS NULL
          LIMIT 5000
        )
        INSERT INTO torrent_search_indexes (info_hash, search_text)
        SELECT 
          b.info_hash,
          CONCAT_WS(' ', 
            b.name, 
            (SELECT string_agg(tf.path, ' ') FROM torrent_files tf WHERE tf.info_hash = b.info_hash),
            (SELECT string_agg(c.title, ' ') 
             FROM torrent_contents tc 
             JOIN content c ON tc.content_id = c.id AND tc.content_type = c.type AND tc.content_source = c.source 
             WHERE tc.info_hash = b.info_hash)
          ) AS search_text
        FROM batch b
        INNER JOIN torrents safe_t ON safe_t.info_hash = b.info_hash
        ON CONFLICT (info_hash) DO UPDATE 
        SET search_text = EXCLUDED.search_text;
      `;

      const indexRes = await client.query(indexQuery);
      if (indexRes.rowCount === 0) break; 
      
      p1Processed += indexRes.rowCount;
      console.log(`   ...indexed ${p1Processed} text documents`);
    }
    console.log(`✅ [Phase 1] Complete! Total indexed: ${p1Processed}`);

    // ==========================================
    // PHASE 2: Sync Payload Compositions (Batched + Single File Support)
    // ==========================================
    console.log("⏳ [Phase 2] Calculating payload compositions...");
    let p2Processed = 0;

    while (true) {
      const compositionQuery = `
        WITH batch AS (
          SELECT t.info_hash, t.name
          FROM torrents t
          LEFT JOIN torrent_compositions tc ON t.info_hash = tc.info_hash
          WHERE tc.info_hash IS NULL
          LIMIT 5000
        ),
        file_counts AS (
          SELECT 
            b.info_hash,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'video' THEN 1 END) as video,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'audio' THEN 1 END) as audio,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'img' THEN 1 END) as image,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'doc' THEN 1 END) as doc,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'archive' THEN 1 END) as archive,
            COUNT(CASE WHEN get_custom_category(tf.extension) = 'app' THEN 1 END) as app,
            COUNT(CASE WHEN get_custom_category(tf.extension) NOT IN ('video','audio','img','doc','archive','app') AND tf.extension IS NOT NULL THEN 1 END) as other
          FROM batch b
          LEFT JOIN torrent_files tf ON tf.info_hash = b.info_hash
          GROUP BY b.info_hash
        )
        INSERT INTO torrent_compositions (
          info_hash, video_count, audio_count, image_count, document_count, archive_count, app_count, other_count
        )
        SELECT 
          fc.info_hash,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'video' THEN 1 ELSE fc.video END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'audio' THEN 1 ELSE fc.audio END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'img' THEN 1 ELSE fc.image END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'doc' THEN 1 ELSE fc.doc END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'archive' THEN 1 ELSE fc.archive END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'app' THEN 1 ELSE fc.app END,
          CASE WHEN (fc.video + fc.audio + fc.image + fc.doc + fc.archive + fc.app + fc.other) = 0 
               AND (get_custom_category(substring(b.name from '\\.([^\\.]+)$')) = 'other' OR get_custom_category(substring(b.name from '\\.([^\\.]+)$')) IS NULL) THEN 1 ELSE fc.other END
        FROM file_counts fc
        JOIN batch b ON b.info_hash = fc.info_hash
        INNER JOIN torrents safe_t ON safe_t.info_hash = fc.info_hash
        ON CONFLICT (info_hash) DO NOTHING;
      `;

      const compRes = await client.query(compositionQuery);
      if (compRes.rowCount === 0) break;

      p2Processed += compRes.rowCount;
      console.log(`   ...calculated compositions for ${p2Processed} torrents`);
    }
    console.log(`✅ [Phase 2] Complete! Total calculated: ${p2Processed}`);

  } catch (err) {
    console.error("❌ Database Error during Janitor run:", err);
  } finally {
    await client.end();
    console.log(`[${new Date().toISOString()}] 🏁 Janitor finished.`);
  }
}

runJanitor();