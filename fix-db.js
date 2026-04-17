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
      await client.query(`UPDATE torrents SET tsv = to_tsvector('simple', name);`);
      await client.query(`CREATE INDEX torrents_tsv_idx ON torrents USING GIN(tsv);`);
      console.log("Success: 'tsv' column created and indexed.");
    } else {
      console.log("'tsv' column already exists. Skipping.");
    }

    console.log("\nDB Repair Complete! You can now run 'npm run dev'.");
  } catch (err) {
    console.error("\nERROR REPAIRING DATABASE:");
    console.error(err.message);
  } finally {
    await client.end();
  }
}

fix();