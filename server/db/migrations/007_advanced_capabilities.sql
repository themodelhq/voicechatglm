-- v1.2.6: durable private-source processing, OCR provenance and external-vector lifecycle.
-- External service secrets and embeddings themselves never enter this database.

CREATE TABLE IF NOT EXISTS knowledge_processing_jobs (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type VARCHAR(32) NOT NULL CHECK (job_type IN ('index_text', 'ocr_index', 'reindex', 'vector_delete')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'completed', 'partially_completed', 'failed', 'cancelled')),
  idempotency_key VARCHAR(120) NOT NULL,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 8),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_code VARCHAR(80),
  error_message VARCHAR(400),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, job_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_claim_idx ON knowledge_processing_jobs(status, next_attempt_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS knowledge_processing_jobs_owner_idx ON knowledge_processing_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_source_pages (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number > 0 AND page_number <= 10000),
  extraction_method VARCHAR(24) NOT NULL CHECK (extraction_method IN ('native_text', 'ocr')),
  processing_status VARCHAR(24) NOT NULL CHECK (processing_status IN ('completed', 'partial', 'failed')),
  content TEXT NOT NULL,
  content_sha256 CHAR(64) NOT NULL,
  confidence NUMERIC(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, page_number)
);
CREATE INDEX IF NOT EXISTS knowledge_source_pages_source_idx ON knowledge_source_pages(source_id, page_number);

CREATE TABLE IF NOT EXISTS knowledge_embedding_records (
  id UUID PRIMARY KEY,
  chunk_id UUID NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vector_id VARCHAR(160) NOT NULL,
  provider VARCHAR(120) NOT NULL,
  model VARCHAR(160) NOT NULL,
  model_version VARCHAR(160),
  dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 8 AND 4096),
  content_sha256 CHAR(64) NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(chunk_id),
  UNIQUE(user_id, vector_id)
);
CREATE INDEX IF NOT EXISTS knowledge_embedding_source_idx ON knowledge_embedding_records(source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS knowledge_embedding_owner_idx ON knowledge_embedding_records(user_id, indexed_at DESC) WHERE deleted_at IS NULL;
