ALTER TABLE analysis_jobs
  ADD COLUMN IF NOT EXISTS worker_id VARCHAR(160),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE analysis_jobs
SET max_attempts = GREATEST(max_attempts, 3)
WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS analysis_jobs_worker_queue_idx
  ON analysis_jobs(status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'processing');
