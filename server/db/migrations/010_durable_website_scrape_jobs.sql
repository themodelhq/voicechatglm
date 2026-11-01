CREATE TABLE IF NOT EXISTS website_scrape_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_message_id UUID,
  seed_urls JSONB NOT NULL,
  request_message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','partial','failed')),
  pages_visited INTEGER NOT NULL DEFAULT 0,
  pages_discovered INTEGER NOT NULL DEFAULT 0,
  products_found INTEGER NOT NULL DEFAULT 0,
  failed_pages INTEGER NOT NULL DEFAULT 0,
  artifact_id UUID,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  worker_id VARCHAR(120),
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS website_scrape_jobs_queue_idx ON website_scrape_jobs(status, created_at) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS website_scrape_jobs_owner_idx ON website_scrape_jobs(user_id, created_at DESC);
