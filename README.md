<img align="left" width="90" height="90" src="public/compass_logo.png" alt="Lodestar Logo">

# Lodestar
**A beautiful, high-performance discovery interface for [Bitmagnet](https://github.com/bitmagnet-io/bitmagnet).**
<br><br>
<br>

Lodestar acts as a heavily customized frontend that connects to your existing Bitmagnet database and translates standard queries into highly optimized **PGroonga** network commands. This unlocks advanced features like tiered relevance ranking, deep file-path searching, and progressive UI filtering, allowing you to parse millions of torrents in milliseconds.

![Lodestar Screenshot 1](public/Screenshot%201.png)
![Lodestar Screenshot 2](public/Screenshot%202.png)

---

## ⚡ Why Lodestar? (Improvements Over Native)

While the native Bitmagnet web interface is great for basic management, Lodestar is engineered specifically as a high-speed, aesthetically driven **discovery engine**.

* **Information Density:** Say goodbye to clunky, screen-hogging cards. Lodestar utilizes a bespoke accordion layout that keeps critical metadata (Size, Seeders, Magnet Link, Age) visible at all times, without overwhelming your screen.
* **Progressive Disclosure UI:** The interface remains whisper-quiet by default. Heavy machinery like Regex exclusions, spam toggles, and payload compositions are tucked neatly into a collapsible "Advanced Filters" drawer. 
* **Zero-Cost Infinite Scrolling:** Expanding a torrent instantly loads a cached preview of its files with zero network cost. If you scroll to the bottom of a massive 500-episode anime pack, Lodestar seamlessly "lazy loads" the rest of the files in the background without locking up your browser.
* **Smart Single-File Fallbacks:** Native Bitmagnet hides single-file torrents from the file tree entirely. Lodestar's backend dynamically synthesizes these missing files so your UI never awkwardly says "No files available" for a standard movie release.

---

## 🏆 The Discovery Engine 

Lodestar automatically detects and configures itself for the following ranking tiers:

* **🥇 Gold Tier:** The holy grail. The user's query exists in both the torrent **Title** AND the internal **File List** (e.g., Season Packs).
* **🥈 Silver Tier:** The query matches the **Title** of the torrent.
* **🥉 Bronze Tier:** The query matches deep within the **File List**. These are ranked by *Density*.

Ties are mathematically broken using swarm health (Seeders/Leechers) and Time Decay (new releases get a freshness boost).

---

## 🧱 Under the Hood (Tech Stack)

Lodestar leverages modern web and database technologies to keep resource usage incredibly low:
* **Frontend:** Built on **Next.js, React, & NextUI**. Server-side rendered for immediate load times.
* **Database:** Connects directly to **PostgreSQL**.
* **Search Engine:** **PGroonga**. A blazingly fast full-text search extension for Postgres, purpose-built for handling complex symbols, wildcards, and multilingual queries.
* **Sync Engine:** A lightweight **Node.js** Janitor script that uses highly optimized Postgres UPSERTs to keep the search index perfectly synced with Bitmagnet's crawler.

---

## Part 1: Prerequisites

Before starting, ensure you have the following installed on your server or machine:

1.  **Bitmagnet & PostgreSQL**: A running Bitmagnet instance.
2.  **PGroonga Extension**: Your Postgres database must have the PGroonga extension installed.
3.  **Docker** (Recommended) or **Node.js** (LTS Version).

---

## Part 2: Database Preparation

⚠️ **CRITICAL WARNING: BACKUP YOUR DATABASE FIRST** ⚠️
Lodestar's deep-file searching requires structural changes to your database indexes. While safe, it is **highly recommended** to back up your database before proceeding. We are not responsible for corrupted data!

**To backup via Docker:**
```bash
docker exec -t <postgres-container-name> pg_dump -U <username> bitmagnet > bitmagnet_backup.sql
```
*(Replace `<postgres-container-name>` and `<username>` with your actual compose values, typically `postgres` for both).*

---

**THE SQL SCRIPT:**
Once backed up, you must run this SQL command in your Bitmagnet database console before starting the app. This creates the sidecar table and applies the `TokenBigram` indexing necessary for the search engine to function correctly.

```sql
CREATE TABLE IF NOT EXISTS torrent_search_indexes (
    info_hash bytea PRIMARY KEY,
    search_text text
);

CREATE INDEX IF NOT EXISTS ix_torrent_search_pgroonga 
ON torrent_search_indexes USING pgroonga (search_text) 
WITH (tokenizer='TokenBigram');
```
*(Note: Ensure your main `torrents` table also has a PGroonga Bigram index on the `name` column for accurate title matching).*

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

As Bitmagnet discovers new torrents, they must be pushed into the search index. Set the `janitor.js` script to run every 15 to 30 minutes (using Cron or Unraid User Scripts).

* **Via Docker**: `docker exec lodestar node scripts/janitor.js`
* **Via Manual**: `node scripts/janitor.js`

---

## Part 6: Search Syntax Guide

Lodestar leverages PGroonga Query Syntax. Note that boolean operators must be **UPPERCASE**.

| Feature | Syntax | Example |
| :--- | :--- | :--- |
| **OR Logic** | `OR` | `Ubuntu OR Debian` (Must be uppercase) |
| **Wildcards** | `*` at the end | `comput*` finds computer, computing, etc. |
| **Exclusion** | `-` before a word | `knight -joker` hides results containing Joker. |
| **Exact Phrase**| `" "` | `"the dark knight"` |
| **Regex** | `~ "pattern"` | `~ "S0[1-9]E[0-9]"` |

---

## ❤️ Acknowledgments

This project is a heavily modified fork of the [Bitmagnet-Next-Web](https://github.com/journey-ad/Bitmagnet-Next-Web) repository by [journey-ad](https://github.com/journey-ad). Lodestar extends the original vision with a focus on PGroonga optimization and specialized discovery workflows.

Maintained with ❤️ for the Bitmagnet data-hoarding community.