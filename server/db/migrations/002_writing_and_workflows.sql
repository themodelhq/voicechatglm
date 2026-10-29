CREATE TABLE IF NOT EXISTS writing_projects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'outlining', 'ready', 'generating', 'partially_generated', 'failed', 'cancelled', 'completed')),
  outline TEXT,
  continuity_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS writing_projects_owner_updated_idx ON writing_projects(user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS writing_chapters (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0 AND ordinal <= 500),
  title VARCHAR(300) NOT NULL,
  plan TEXT,
  content TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'generating', 'draft', 'approved', 'failed', 'cancelled')),
  continuity_summary TEXT,
  idempotency_key VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, ordinal),
  UNIQUE(project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS writing_chapters_project_order_idx ON writing_chapters(project_id, ordinal);

CREATE TABLE IF NOT EXISTS writing_chapter_revisions (
  id UUID PRIMARY KEY,
  chapter_id UUID NOT NULL REFERENCES writing_chapters(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  content TEXT NOT NULL,
  change_note VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(chapter_id, revision_number)
);

CREATE TABLE IF NOT EXISTS writing_notes (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
  note_type VARCHAR(32) NOT NULL CHECK (note_type IN ('character', 'setting', 'plot', 'continuity', 'source', 'general')),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS writing_notes_project_idx ON writing_notes(project_id, created_at ASC);

CREATE TABLE IF NOT EXISTS workflow_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_type VARCHAR(48) NOT NULL CHECK (workflow_type IN ('writing_outline', 'writing_chapter', 'research_and_synthesis', 'website_scraping')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'processing', 'partially_completed', 'completed', 'failed', 'cancelled')),
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  idempotency_key VARCHAR(120),
  cancel_requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code VARCHAR(80),
  error_message VARCHAR(400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, workflow_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS workflow_jobs_owner_idx ON workflow_jobs(user_id, created_at DESC);
