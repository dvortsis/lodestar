<img align="left" width="90" height="90" src="public/compass_logo.png" alt="Lodestar Logo">

# Lodestar
**A beautiful, high-performance discovery interface for [Bitmagnet](https://github.com/bitmagnet-io/bitmagnet).**
<br><br>
<br>

Lodestar acts as a heavily customized frontend that connects to your existing Bitmagnet database and translates standard queries into highly optimized **PGroonga** network commands. This unlocks advanced features like an 8-tier semantic relevance engine, deep file-path searching, and progressive UI filtering, allowing you to parse millions of torrents in milliseconds.

![Lodestar Screenshot 1](public/Screenshot%201.png)
![Lodestar Screenshot 2](public/Screenshot%202.png)
![Lodestar Screenshot 3](public/Screenshot%203.png)

---

## ⚡ Why Lodestar? (Improvements Over Native)

While the native Bitmagnet web interface is great for basic management, Lodestar is engineered specifically as a high-speed, aesthetically driven **discovery engine**.

* **Payload Composition Visualizer:** Instantly see what's inside a torrent before you even expand it. A sleek, Tableau-colored visual barcode at the bottom of every card shows the exact breakdown of Video, Audio, Image, Document, and Archive files.
* **Staged Advanced Filters:** Gain granular control over your search. Set complex rules like "Only show torrents where >80% of the files are Images" or "Exclude any torrents containing Apps/Executables." Filter changes are cleanly staged in a draft state until you hit Apply.
* **Information Density:** Say goodbye to clunky, screen-hogging cards. Lodestar utilizes a bespoke accordion layout that keeps critical metadata (Size, Seeders, Magnet Link, Age) visible at all times, without overwhelming your screen.
* **Zero-Cost Infinite Scrolling:** Expanding a torrent instantly loads a cached preview of its files with zero network cost. If you scroll to the bottom of a massive 500-episode anime pack, Lodestar seamlessly "lazy loads" the rest of the files in the background without locking up your browser.
* **Smart Single-File Fallbacks:** Native Bitmagnet hides single-file torrents from the file tree entirely. Lodestar's backend dynamically synthesizes these missing files so your UI never awkwardly says "No files available" for a standard movie release.

---

## 🏆 The Discovery Engine (8-Tier Semantic Ranking)

Most torrent search engines rely on basic OR logic, which fills your results with noisy, irrelevant data. Lodestar uses a custom-built **Semantic Waterfall Engine** directly inside Postgres. It evaluates queries across 8 strict tiers, isolating the exact releases you want while burying the "data dump" noise.

* **Tier 1 - Exact Phrase (100M points):** The holy grail. The user's exact phrase exists perfectly in the title.
* **Tier 2 - Fuzzy Ordered Phrase (75M points):** Accounts for plurals and suffixes while maintaining strict word order using ultra-fast native ILIKE operators.
* **Tier 3 - Strict Intersection (50M points):** "All Words" match. Dynamically calculates `minRequiredWords` to ensure true Boolean AND logic, even if words are out of order.
* **Tier 4 - PGroonga Partial Hit (10M points):** General fuzzy/partial token matches within the title.
* **Tiers 5 through 8 (File Deep-Search):** The exact same logic as above, but applied to the internal file lists. Mathematical caps prevent a torrent with massive file lists from ever outranking a direct Title match.

*Note: The Phrase tiers (1 and 2) are dynamically bypassed if the user employs Boolean operators (like `OR` or `|`), allowing the Word Count tier to mathematically calculate the perfect logical intersection.*

Ties within tiers are broken using swarm health (Seeders/Leechers) and Time Decay (new releases get a freshness boost).

---

## 🧱 Under the Hood (Tech Stack)

Lodestar leverages modern web and database technologies to keep resource usage incredibly low:
* **Frontend:** Built on **Next.js, React, & NextUI**. Server-side rendered for immediate load times.
* **Database (Decoupled Architecture):** Connects directly to **PostgreSQL**. Uses highly optimized 1:1 "Sidecar" tables to handle massive data aggregations without causing MVCC bloat on your main database.
* **Search Engine:** **PGroonga**. A blazingly fast full-text search extension for Postgres, purpose-built for handling complex symbols, wildcards, and multilingual queries.
* **Sync Engine:** A lightweight **Node.js** dual-engine Janitor script that uses background UPSERTs to keep both text indexes and payload counts perfectly synced with Bitmagnet's crawler.

---

## Part 1: Prerequisites

Before starting, ensure you have the following installed on your server or machine:

1.  **Bitmagnet & PostgreSQL**: A running Bitmagnet instance.
2.  **PGroonga Extension**: Your Postgres database must have the PGroonga extension installed.
3.  **Docker** (Recommended) or **Node.js** (LTS Version).

---

## Part 2: Database Preparation

⚠️ **CRITICAL WARNING: BACKUP YOUR DATABASE FIRST** ⚠️
Lodestar requires structural additions to your database (Sidecar tables and indexes). While completely non-destructive to native Bitmagnet data, it is **highly recommended** to back up your database before proceeding.

**To backup via Docker:**
```bash
docker exec -t <postgres-container-name> pg_dump -U <username> bitmagnet > bitmagnet_backup.sql
```

**THE SQL SCRIPT:**
Run this SQL command in your Bitmagnet database console to create the Dual-Sidecar architecture required for deep-search and payload visualizations:

```sql
-- Sidecar A: Text Discovery (PGroonga)
CREATE TABLE IF NOT EXISTS torrent_search_indexes (
    info_hash bytea PRIMARY KEY REFERENCES torrents(info_hash) ON DELETE CASCADE,
    search_text text
);

CREATE INDEX IF NOT EXISTS ix_torrent_search_pgroonga 
ON torrent_search_indexes USING pgroonga (search_text) 
WITH (tokenizer='TokenBigram');

-- Sidecar B: Payload Composition (UI Visuals)
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
```

---

## Part 3: Configuration (.env file)

Lodestar uses a hidden configuration file named `.env` to talk to your database. 

Create a file named `.env` in the root folder:

```text
POSTGRES_DB_URL="postgresql://username:password@localhost:5432/bitmagnet"
```

---

## Part 4: Installing & Running the App

### Option A: Docker Compose (Recommended)
Add Lodestar as a new service at the bottom of your existing Bitmagnet compose file:

```yaml
  lodestar:
    build: ./path/to/lodestar/folder
    container_name: lodestar
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - POSTGRES_DB_URL=postgresql://username:password@postgres:5432/bitmagnet
    depends_on:
      - postgres
```
Run `docker compose up -d --build lodestar` to start the frontend.

---

## Part 5: The Janitor Script (Maintenance)

As Bitmagnet discovers new torrents, Lodestar needs to calculate their file counts and index their text. Set the `scripts/janitor.js` script to run in the background (e.g., every 15 to 60 minutes) using Cron or Unraid User Scripts. 

The script safely processes Phase 1 (Text Indexing) and Phase 2 (Payload Math) in optimized batches.

* **Via Docker**: `docker exec lodestar node scripts/janitor.js`
* **Via Manual**: `node scripts/janitor.js`
* **Via NPM**: `npm run janitor`

---

## Part 6: Search Syntax Guide

Search uses a smart **Semantic Ranking Engine** powered by PGroonga. Type naturally, or use operators to strictly control your results. **Do not wrap your entire query in quotes** unless you want an exact phrase match. Queries are translated into **PGroonga** syntax server-side.

### Basic logic

- **AND (default):** `dark knight` or `dark AND knight` — both words are required.
- **OR / pipe:** `batman OR joker` or `batman | joker` — either word matches.
- **Exclusion:** `knight -joker` — hides any result containing `joker`.

### Precision and smart matching

- **Exact phrase:** `"the dark knight"` — quotes force exact order and spelling.
- **Smart suffixes:** The engine automatically detects plurals and suffixes. Searching `linux update` will naturally rank `linux updates` right below exact matches.
- **Prefix wildcard:** `comput*` — matches `computer`, `computing`, and so on (wildcard path; bypasses smart filters).

### Expert filters

- **Grouping:** `(batman | joker) AND "justice league"`
- **Proximity:** `*W"dark knight" 5` — these words within 5 positions of each other (PGroonga proximity).
- **Regex:** `~ "S0[1-9]E[0-9]"` — full pattern inside quotes; slower but precise.

Operators such as `OR` and `AND` are recognized case-insensitively when expanded for the index; writing them in **UPPERCASE** can still make complex queries easier to read.

---

## ❤️ Acknowledgments

This project is a heavily modified fork of the [Bitmagnet-Next-Web](https://github.com/journey-ad/Bitmagnet-Next-Web) repository by [journey-ad](https://github.com/journey-ad). Lodestar extends the original vision with a focus on PGroonga optimization, specialized discovery workflows, and beautiful data visualization.

Maintained with ❤️ for the Bitmagnet data-hoarding community.
