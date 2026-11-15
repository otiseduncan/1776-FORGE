-- 1776 FORGE platform schema, phase 3.
-- NEW 1776 FORGE D1 database only. NEVER run this against the legacy Baldwin Minute Watch database.
-- Contains reference taxonomy (jurisdictions, categories) only. No public records, votes,
-- meetings, road conditions or legal holdings are fabricated here.

-- ---------------------------------------------------------------- identity & sessions
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                 -- SHA-256 hex of the opaque cookie token; raw token never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  expires_at TEXT NOT NULL
);

-- Future premium entitlements are deliberately separate from editorial/community roles.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT,
  PRIMARY KEY (user_id, entitlement)
);

-- ---------------------------------------------------------------- records library
ALTER TABLE documents ADD COLUMN category_id TEXT;
ALTER TABLE documents ADD COLUMN summary TEXT;
ALTER TABLE documents ADD COLUMN citation TEXT;
ALTER TABLE documents ADD COLUMN original_filename TEXT;
ALTER TABLE documents ADD COLUMN file_size INTEGER;
ALTER TABLE documents ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'official';
ALTER TABLE documents ADD COLUMN verified_by TEXT;
ALTER TABLE documents ADD COLUMN verified_at TEXT;
ALTER TABLE documents ADD COLUMN created_by TEXT;
ALTER TABLE documents ADD COLUMN updated_at TEXT;
ALTER TABLE documents ADD COLUMN integrity_checked_at TEXT;
ALTER TABLE documents ADD COLUMN integrity_state TEXT;
CREATE INDEX IF NOT EXISTS documents_by_sha ON documents(original_sha256);
CREATE INDEX IF NOT EXISTS documents_by_source ON documents(source_url);
CREATE INDEX IF NOT EXISTS documents_by_category ON documents(category_id, record_date);

CREATE TABLE IF NOT EXISTS document_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,          -- article | document | map_feature | legal | meeting
  subject_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT,
  document_id TEXT REFERENCES documents(id),
  pinpoint TEXT,                       -- page / section / timestamp
  note TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS citations_by_subject ON citations(subject_type, subject_id);

ALTER TABLE content_links ADD COLUMN created_by TEXT;
CREATE INDEX IF NOT EXISTS content_links_target ON content_links(target_type, target_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,            -- comment | map_report | map_feature | discussion
  owner_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_by TEXT REFERENCES users(id),
  moderation_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS attachments_by_owner ON attachments(owner_type, owner_id);

-- ---------------------------------------------------------------- community
CREATE TABLE IF NOT EXISTS forum_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100
);
ALTER TABLE discussions ADD COLUMN category_id TEXT;
ALTER TABLE discussions ADD COLUMN body TEXT;
ALTER TABLE discussions ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discussions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discussions ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discussions ADD COLUMN last_activity_at TEXT;
ALTER TABLE discussions ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS discussions_by_context ON discussions(context_type, context_id);
CREATE INDEX IF NOT EXISTS discussions_by_activity ON discussions(last_activity_at);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','actioned','dismissed')),
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reporter_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS follows (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS follows_by_target ON follows(target_type, target_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications(user_id, read_at, created_at);

-- ---------------------------------------------------------------- newsroom
CREATE TABLE IF NOT EXISTS article_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS article_tags (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);
ALTER TABLE articles ADD COLUMN category_id TEXT;
ALTER TABLE articles ADD COLUMN kind TEXT NOT NULL DEFAULT 'report';  -- investigation | report | update | explainer | commentary
ALTER TABLE articles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN video_url TEXT;
ALTER TABLE articles ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE articles ADD COLUMN reviewed_by TEXT;
ALTER TABLE articles ADD COLUMN review_note TEXT;
ALTER TABLE articles ADD COLUMN jurisdiction_id TEXT;
ALTER TABLE articles ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS articles_by_status ON articles(status, published_at);

CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  edited_by TEXT REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, version)
);

CREATE TABLE IF NOT EXISTS article_corrections (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'correction' CHECK(kind IN ('correction','clarification','update','editors_note')),
  body TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- constitution & law
ALTER TABLE legal_authorities ADD COLUMN category TEXT;            -- founding | constitution | amendment | federal_statute | federal_case | state_constitution | state_statute | state_case
ALTER TABLE legal_authorities ADD COLUMN short_title TEXT;
ALTER TABLE legal_authorities ADD COLUMN summary TEXT;
ALTER TABLE legal_authorities ADD COLUMN text_kind TEXT NOT NULL DEFAULT 'original_text'; -- original_text | current_authority | historical_version | judicial_interpretation
ALTER TABLE legal_authorities ADD COLUMN status TEXT NOT NULL DEFAULT 'in_force';          -- in_force | repealed | superseded | historical
ALTER TABLE legal_authorities ADD COLUMN body_text TEXT;
ALTER TABLE legal_authorities ADD COLUMN body_text_source TEXT;
ALTER TABLE legal_authorities ADD COLUMN annotated_url TEXT;
ALTER TABLE legal_authorities ADD COLUMN court TEXT;
ALTER TABLE legal_authorities ADD COLUMN decided_at TEXT;
ALTER TABLE legal_authorities ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE legal_authorities ADD COLUMN created_by TEXT;
ALTER TABLE legal_authorities ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS legal_by_category ON legal_authorities(category, sort_order);

-- ---------------------------------------------------------------- resource directory
ALTER TABLE resource_links ADD COLUMN level TEXT;               -- federal | state | county | municipal | nonprofit | academic
ALTER TABLE resource_links ADD COLUMN topics TEXT;              -- comma-separated research categories
ALTER TABLE resource_links ADD COLUMN subpages_json TEXT;       -- [{"label","url"}]
ALTER TABLE resource_links ADD COLUMN last_status_code INTEGER;
ALTER TABLE resource_links ADD COLUMN notes TEXT;
ALTER TABLE resource_links ADD COLUMN updated_at TEXT;

-- ---------------------------------------------------------------- map
ALTER TABLE map_features ADD COLUMN description TEXT;
ALTER TABLE map_features ADD COLUMN properties_json TEXT;
ALTER TABLE map_features ADD COLUMN condition_note TEXT;
ALTER TABLE map_features ADD COLUMN condition_observed_at TEXT;
ALTER TABLE map_features ADD COLUMN verification_state TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE map_features ADD COLUMN created_by TEXT;
ALTER TABLE map_features ADD COLUMN updated_at TEXT;
CREATE INDEX IF NOT EXISTS map_features_by_kind ON map_features(kind, jurisdiction_id);

ALTER TABLE map_reports ADD COLUMN category TEXT;
ALTER TABLE map_reports ADD COLUMN lat REAL;
ALTER TABLE map_reports ADD COLUMN lng REAL;
ALTER TABLE map_reports ADD COLUMN jurisdiction_id TEXT;
ALTER TABLE map_reports ADD COLUMN reviewed_by TEXT;
ALTER TABLE map_reports ADD COLUMN reviewed_at TEXT;
ALTER TABLE map_reports ADD COLUMN review_note TEXT;
CREATE INDEX IF NOT EXISTS map_reports_by_state ON map_reports(review_state, created_at);

-- ---------------------------------------------------------------- meetings, votes, budgets
CREATE TABLE IF NOT EXISTS governing_bodies (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  name TEXT NOT NULL,
  official_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS officials (
  id TEXT PRIMARY KEY,
  body_id TEXT NOT NULL REFERENCES governing_bodies(id),
  name TEXT NOT NULL,
  office TEXT NOT NULL,
  district TEXT,
  term_start TEXT,
  term_end TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  body_id TEXT NOT NULL REFERENCES governing_bodies(id),
  meeting_date TEXT NOT NULL,
  meeting_type TEXT NOT NULL DEFAULT 'regular',
  title TEXT NOT NULL,
  agenda_document_id TEXT REFERENCES documents(id),
  minutes_document_id TEXT REFERENCES documents(id),
  transcript_document_id TEXT REFERENCES documents(id),
  video_url TEXT,
  minutes_status TEXT NOT NULL DEFAULT 'unavailable', -- unavailable | draft | approved
  source_url TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS meetings_by_body_date ON meetings(body_id, meeting_date);
CREATE TABLE IF NOT EXISTS motions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  item_number TEXT,
  title TEXT NOT NULL,
  motion_text TEXT,
  resolution_number TEXT,
  moved_by TEXT REFERENCES officials(id),
  seconded_by TEXT REFERENCES officials(id),
  result TEXT NOT NULL DEFAULT 'unrecorded' CHECK(result IN ('passed','failed','tabled','withdrawn','unrecorded')),
  supporting_document_id TEXT REFERENCES documents(id),
  source_pinpoint TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS votes (
  motion_id TEXT NOT NULL REFERENCES motions(id) ON DELETE CASCADE,
  official_id TEXT NOT NULL REFERENCES officials(id),
  vote TEXT NOT NULL CHECK(vote IN ('yea','nay','abstain','absent','recused')),
  PRIMARY KEY (motion_id, official_id)
);
CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  fiscal_year INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'adopted' CHECK(stage IN ('proposed','adopted','amended','actual')),
  title TEXT NOT NULL,
  document_id TEXT REFERENCES documents(id),
  source_url TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(jurisdiction_id, fiscal_year, stage, title)
);
CREATE TABLE IF NOT EXISTS budget_line_items (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  fund TEXT NOT NULL DEFAULT 'General Fund',
  department TEXT NOT NULL,
  line_type TEXT NOT NULL CHECK(line_type IN ('revenue','expenditure')),
  description TEXT,
  amount_cents INTEGER NOT NULL,
  source_pinpoint TEXT
);
CREATE INDEX IF NOT EXISTS budget_lines_by_budget ON budget_line_items(budget_id, department);
CREATE TABLE IF NOT EXISTS financial_reports (
  id TEXT PRIMARY KEY,
  jurisdiction_id TEXT NOT NULL REFERENCES jurisdictions(id),
  fiscal_year INTEGER NOT NULL,
  report_type TEXT NOT NULL,              -- ACFR | single audit | management letter | monthly | quarterly
  audited INTEGER NOT NULL DEFAULT 0,
  auditor TEXT,
  opinion TEXT,                           -- only as stated in the report itself
  document_id TEXT REFERENCES documents(id),
  source_url TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- legacy import ledger
CREATE TABLE IF NOT EXISTS legacy_import_batches (
  id TEXT PRIMARY KEY,
  manifest_sha256 TEXT NOT NULL,
  source_description TEXT NOT NULL,
  expected_rows INTEGER,
  expected_objects INTEGER,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  imported_objects INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'planned',  -- planned | rehearsal | imported | reconciled | failed
  report_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------- reference taxonomy (not records)
INSERT OR IGNORE INTO jurisdictions(id,name,level,parent_id,state_code) VALUES
 ('us','United States','federal',NULL,NULL),
 ('ga','State of Georgia','state','us','GA'),
 ('ga-baldwin','Baldwin County','county','ga','GA'),
 ('ga-milledgeville','City of Milledgeville','city','ga-baldwin','GA');

INSERT OR IGNORE INTO document_categories(id,name,description,sort_order) VALUES
 ('budget','Budgets','Proposed, adopted and amended budgets.',10),
 ('audit','Audits & financial reports','Audited and unaudited financial statements and auditor letters.',20),
 ('agenda','Meeting agendas','Published agendas and agenda packets.',30),
 ('minutes','Meeting minutes','Draft and approved minutes.',40),
 ('transcript','Transcripts','Transcripts of meetings and hearings.',45),
 ('ordinance','Ordinances & resolutions','Adopted local legislation.',50),
 ('contract','Contracts & procurement','Bids, awards, contracts and change orders.',60),
 ('open-records','Open-records responses','Responses to open-records (ORA/FOIA) requests.',70),
 ('court','Court filings','Pleadings, orders and judgments.',80),
 ('legislation','Legislation','Bills, acts and statutes.',90),
 ('report','Reports & studies','Government reports, studies and plans.',100),
 ('correspondence','Correspondence','Letters and email released as public records.',110),
 ('map','Maps & plans','Engineering plans, plats and GIS exports.',120),
 ('evidence','Photos & evidence','Photographs and field evidence with provenance.',130),
 ('other','Other','Records that fit no other category.',999);

INSERT OR IGNORE INTO forum_categories(id,name,description,sort_order) VALUES
 ('general','General discussion','Open conversation about civic life and the FORGE mission.',10),
 ('local-government','Local government','County and city decisions, meetings, budgets and votes.',20),
 ('records-requests','Records requests','Plan, share and discuss open-records requests and responses.',30),
 ('roads-infrastructure','Roads & infrastructure','Road conditions, public works and infrastructure projects.',40),
 ('constitution-law','Constitution & law','Constitutional principles, statutes and court decisions.',50),
 ('site-feedback','Site feedback','Suggestions and corrections for 1776 FORGE itself.',90);

INSERT OR IGNORE INTO article_categories(id,name,description,sort_order) VALUES
 ('investigations','Investigations','Long-form, document-driven investigative reporting.',10),
 ('local-government','Local government','Coverage of county and city government.',20),
 ('budgets-finance','Budgets & finance','Public money: budgets, audits, taxes and spending.',30),
 ('infrastructure','Roads & infrastructure','Roads, utilities and public works.',40),
 ('constitution','Constitution & rights','Constitutional education and civil liberties.',50),
 ('explainers','Explainers','How government works and how to research it.',60);
