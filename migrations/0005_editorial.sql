-- 0005 — Editorial publishing system.
-- Additive only: new nullable columns and new tables. No existing row is modified, deleted or duplicated,
-- so the migration is safe to apply to a database that already holds published articles and public records.
-- Rollback: see docs/EDITORIAL.md ("Rolling back 0005"). New columns can be ignored by older code; the new
-- tables can be dropped without touching articles, documents or citations.

-- ---------------------------------------------------------------- article metadata
-- `summary` remains the deck (standfirst). `excerpt` is the short teaser used on cards and in search results.
ALTER TABLE articles ADD COLUMN excerpt TEXT;
ALTER TABLE articles ADD COLUMN byline TEXT;                     -- display byline; defaults to the author's name
ALTER TABLE articles ADD COLUMN original_publisher TEXT;         -- historical attribution, e.g. the publication it first ran in
ALTER TABLE articles ADD COLUMN original_published_at TEXT;      -- date of first publication elsewhere (YYYY-MM-DD)
ALTER TABLE articles ADD COLUMN original_headline TEXT;
ALTER TABLE articles ADD COLUMN original_url TEXT;
ALTER TABLE articles ADD COLUMN provenance_note TEXT;            -- how this text reached FORGE (source file, SHA-256, edits made)
ALTER TABLE articles ADD COLUMN manuscript_state TEXT NOT NULL DEFAULT 'original';
  -- original | imported | needs_manuscript | needs_evidence
ALTER TABLE articles ADD COLUMN hero_media_id TEXT;
ALTER TABLE articles ADD COLUMN seo_title TEXT;
ALTER TABLE articles ADD COLUMN seo_description TEXT;
ALTER TABLE articles ADD COLUMN keywords TEXT;                   -- comma-separated
ALTER TABLE articles ADD COLUMN series_id TEXT;
ALTER TABLE articles ADD COLUMN series_order INTEGER;
ALTER TABLE articles ADD COLUMN legacy_ref TEXT;                 -- stable inventory key for imported/placeholder stories
CREATE UNIQUE INDEX IF NOT EXISTS articles_legacy_ref ON articles(legacy_ref) WHERE legacy_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS articles_by_series ON articles(series_id, series_order);
CREATE INDEX IF NOT EXISTS articles_by_jurisdiction ON articles(jurisdiction_id, status, published_at);

-- ---------------------------------------------------------------- series / investigations
CREATE TABLE IF NOT EXISTS article_series (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'series' CHECK(kind IN ('series','investigation')),
  jurisdiction_id TEXT,
  hero_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

-- ---------------------------------------------------------------- editorial media (hero images, inline images)
-- Originals are stored unchanged in R2 under media/… with their SHA-256. `is_illustration` marks artwork that
-- must never be presented as a photograph of a real event.
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  original_filename TEXT,
  alt_text TEXT NOT NULL,
  caption TEXT,
  credit TEXT,
  is_illustration INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS media_by_sha ON media_assets(sha256);

-- ---------------------------------------------------------------- source verification on citations
ALTER TABLE citations ADD COLUMN verified_at TEXT;
ALTER TABLE citations ADD COLUMN verified_by TEXT;
ALTER TABLE citations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

-- ---------------------------------------------------------------- categories for the new story types
INSERT OR IGNORE INTO article_categories(id,name,description,sort_order) VALUES
 ('public-safety','Jails & public safety','Detention, courts, law enforcement and alternatives.',35),
 ('development','Growth & development','Development authorities, data centers, land use and infrastructure.',45),
 ('assessments','Property & assessments','Property assessment, digests, rollback rates and tax administration.',32),
 ('essays','Essays & reflection','Personal essays and reflection, labelled separately from reporting.',70);
