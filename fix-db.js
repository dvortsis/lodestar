const { execSync } = require('child_process');

// --- STEP 1: AUTO-INSTALLER ---
function installMissing() {
  try {
    require.resolve('dotenv');
    require.resolve('pg');
  } catch (e) {
    console.log("Missing components detected. Installing 'dotenv' and 'pg' with legacy-peer-deps...");
    // We added '--legacy-peer-deps' here to bypass the UI version conflicts
    execSync('npm install dotenv pg --legacy-peer-deps', { stdio: 'inherit' });
    console.log("Installation complete.\n");
  }
}

installMissing();

// --- STEP 2: THE REPAIR LOGIC ---
const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function fix() {
  const client = new Client({ connectionString: process.env.POSTGRES_DB_URL });
  
  try {
    await client.connect();
    console.log("Connected to database...");

    // 1. Enable Trigram (Fuzzy matching)
    console.log("Enabling pg_trgm extension...");
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

    // 2. Check/Create TSV column (Advanced Search)
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'torrents' AND column_name = 'tsv';
    `);

    if (res.rows.length === 0) {
      console.log("Column 'tsv' is missing. Upgrading your database schema...");
      await client.query(`ALTER TABLE torrents ADD COLUMN tsv tsvector;`);
      await client.query(`UPDATE torrents SET tsv = to_tsvector('english', name);`);
      await client.query(`CREATE INDEX torrents_tsv_idx ON torrents USING GIN(tsv);`);
      console.log("Success: 'tsv' column created and indexed.");
    } else {
      console.log("'tsv' column already exists. Skipping.");
    }

    // 3) torrent_compositions sidecar (per-torrent file counts by extension category)
    console.log("Ensuring torrent_compositions table exists...");
    await client.query(`
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
    `);

    const fileCatExpr = `
      CASE
        WHEN NULLIF(btrim(lower(tf.extension::text)), '') IS NULL THEN 'other'
        WHEN lower(btrim(tf.extension::text)) IN (
          'mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg','ts','m2ts','vob','3gp','asf','divx'
        ) THEN 'video'
        WHEN lower(btrim(tf.extension::text)) IN (
          'mp3','flac','wav','aac','ogg','opus','m4a','wma','ape','alac','aiff'
        ) THEN 'audio'
        WHEN lower(btrim(tf.extension::text)) IN (
          'zip','rar','7z','tar','gz','bz2','xz','lzma','cab','tgz','lz','zst'
        ) THEN 'archive'
        WHEN lower(btrim(tf.extension::text)) IN (
          'exe','msi','dmg','pkg','deb','rpm','apk','bat','cmd','sh','appimage','msix','jar'
        ) THEN 'app'
        WHEN lower(btrim(tf.extension::text)) IN (
          'pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','epub','mobi','csv','odt','ods'
        ) THEN 'document'
        WHEN lower(btrim(tf.extension::text)) IN (
          'jpg','jpeg','png','gif','webp','bmp','tif','tiff','svg'
        ) THEN 'image'
        ELSE 'other'
      END
    `;

    const BATCH = 2500;
    let offset = 0;
    let totalUpserted = 0;
    console.log("Backfilling torrent_compositions from torrent_files (batched)...");

    for (;;) {
      const slice = await client.query(
        `
        SELECT info_hash
        FROM (SELECT DISTINCT info_hash FROM torrent_files) d
        ORDER BY info_hash
        LIMIT $1 OFFSET $2
        `,
        [BATCH, offset],
      );
      if (slice.rowCount === 0) {
        break;
      }
      const hashes = slice.rows.map((r) => r.info_hash);
      const ins = await client.query(
        `
        INSERT INTO torrent_compositions (
          info_hash,
          video_count,
          audio_count,
          image_count,
          document_count,
          archive_count,
          app_count,
          other_count
        )
        SELECT
          z.info_hash,
          COUNT(*) FILTER (WHERE z.cat = 'video')::int,
          COUNT(*) FILTER (WHERE z.cat = 'audio')::int,
          COUNT(*) FILTER (WHERE z.cat = 'image')::int,
          COUNT(*) FILTER (WHERE z.cat = 'document')::int,
          COUNT(*) FILTER (WHERE z.cat = 'archive')::int,
          COUNT(*) FILTER (WHERE z.cat = 'app')::int,
          COUNT(*) FILTER (WHERE z.cat = 'other')::int
        FROM (
          SELECT tf.info_hash, ${fileCatExpr} AS cat
          FROM torrent_files tf
          WHERE tf.info_hash = ANY($1::bytea[])
        ) z
        GROUP BY z.info_hash
        ON CONFLICT (info_hash) DO UPDATE SET
          video_count = EXCLUDED.video_count,
          audio_count = EXCLUDED.audio_count,
          image_count = EXCLUDED.image_count,
          document_count = EXCLUDED.document_count,
          archive_count = EXCLUDED.archive_count,
          app_count = EXCLUDED.app_count,
          other_count = EXCLUDED.other_count
        `,
        [hashes],
      );
      totalUpserted += ins.rowCount ?? 0;
      offset += BATCH;
    }
    console.log(
      `torrent_compositions: upserted ${totalUpserted} aggregate row(s) over ${offset} distinct info_hash value(s) from torrent_files.`,
    );

    console.log("\nDB Repair Complete! You can now run 'npm run dev'.");
  } catch (err) {
    console.error("\nERROR REPAIRING DATABASE:");
    console.error(err.message);
  } finally {
    await client.end();
  }
}

fix();