/**
 * Lodestar Search Janitor — PGroonga sidecar maintenance
 * -------------------------------------------------------
 * Bitmagnet keeps canonical torrent rows in `torrents` / `torrent_files`; Lodestar’s **Silver**
 * search axis (file paths + metadata text) lives in `torrent_search_indexes.search_text`, fed by
 * this job. Until rows land here, PGroonga cannot score “files” or `both` scope hits against paths.
 *
 * The UPSERT concatenates title, aggregated paths, and linked content titles into one document per
 * `info_hash` — aligned with the GraphQL search pipeline’s expectation that the sidecar is the
 * unified PGroonga document for non-title search. Runs in Postgres for throughput and predictable RAM.
 */

require('dotenv').config({ path: '.env.local' }); // Load standard Next.js env files
require('dotenv').config();

const { Client } = require('pg');

async function runJanitor() {
  console.log(`[${new Date().toISOString()}] 🧹 Starting Lodestar Janitor...`);

  // Grab the database URL from your environment variables
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

    // THE MAGIC SQL
    // This query finds torrents that are NOT in the index yet,
    // squishes their Name, File Paths, and Content Titles into one giant string,
    // and inserts them into the sidecar table.
    const query = `
      WITH new_torrents AS (
        SELECT t.info_hash, t.name
        FROM torrents t
        LEFT JOIN torrent_search_indexes tsi ON t.info_hash = tsi.info_hash
        WHERE tsi.info_hash IS NULL
        -- Optional limit if you have millions of un-indexed rows on first run:
        -- LIMIT 50000 
      )
      INSERT INTO torrent_search_indexes (info_hash, search_text)
      SELECT 
        nt.info_hash,
        CONCAT_WS(' ', 
          nt.name, 
          -- Aggregate all file paths inside this torrent into a single block of text
          (SELECT string_agg(tf.path, ' ') FROM torrent_files tf WHERE tf.info_hash = nt.info_hash),
          -- Aggregate any linked TMDB/Metadata titles
          (SELECT string_agg(c.title, ' ') 
           FROM torrent_contents tc 
           JOIN content c ON tc.content_id = c.id AND tc.content_type = c.type AND tc.content_source = c.source 
           WHERE tc.info_hash = nt.info_hash)
        ) AS search_text
      FROM new_torrents nt
      ON CONFLICT (info_hash) DO UPDATE 
      SET search_text = EXCLUDED.search_text;
    `;

    console.log("⏳ Indexing new torrents...");
    const res = await client.query(query);
    
    console.log(`✅ Success! Indexed ${res.rowCount} new torrents.`);

  } catch (err) {
    console.error("❌ Database Error during Janitor run:", err);
  } finally {
    await client.end();
    console.log(`[${new Date().toISOString()}] 🏁 Janitor finished.`);
  }
}

// Execute the function
runJanitor();