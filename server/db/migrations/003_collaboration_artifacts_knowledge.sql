-- v1.2.0 additive persistence: conversations, generated artifacts, user-approved memory,
-- reliable document retrieval, share links, and durable operation status. Existing v1.1.0 data
-- remains untouched; all primary resources are scoped to the authenticated owner.

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(240) NOT NULL,
  model_id VARCHAR(160),
  agent_id VARCHAR(120),
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_owner_updated_idx ON conversations(user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_owner_flags_idx ON conversations(user_id, pinned DESC, favorite DESC, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content TEXT NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'complete' CHECK (status IN ('sending', 'streaming', 'complete', 'partial', 'error', 'cancelled')),
  client_idempotency_key VARCHAR(120),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(conversation_id, client_idempotency_key)
);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_idx ON conversation_messages(conversation_id, created_at ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS conversation_messages_owner_idx ON conversation_messages(user_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS generated_artifacts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES conversation_messages(id) ON DELETE SET NULL,
  job_id UUID,
  original_filename VARCHAR(180) NOT NULL,
  display_filename VARCHAR(180) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  file_format VARCHAR(24) NOT NULL CHECK (file_format IN ('txt', 'md', 'pdf', 'docx', 'csv', 'xlsx', 'pptx', 'json', 'html', 'code', 'zip')),
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0 AND byte_size <= 52428800),
  storage_key TEXT NOT NULL UNIQUE,
  checksum_sha256 CHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('creating', 'available', 'failed', 'deleted', 'expired')),
  preview_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS generated_artifacts_owner_created_idx ON generated_artifacts(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS generated_artifacts_conversation_idx ON generated_artifacts(conversation_id, created_at ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS generated_artifacts_expiry_idx ON generated_artifacts(expires_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type VARCHAR(32) NOT NULL CHECK (memory_type IN ('explicit_preference', 'project_note', 'stable_fact')),
  label VARCHAR(160) NOT NULL,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  source_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS user_memories_owner_enabled_idx ON user_memories(user_id, enabled, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  original_filename VARCHAR(180) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  detected_type VARCHAR(32) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'extracting', 'indexed', 'partial', 'failed', 'deleted')),
  extraction_storage_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  indexed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_sources_owner_idx ON knowledge_sources(user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0 AND ordinal <= 100000),
  content TEXT NOT NULL,
  section_label VARCHAR(300),
  page_number INTEGER CHECK (page_number IS NULL OR page_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, ordinal)
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_source_idx ON knowledge_chunks(source_id, ordinal);
CREATE INDEX IF NOT EXISTS knowledge_chunks_owner_idx ON knowledge_chunks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_share_links (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  selected_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  title VARCHAR(240),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversation_share_links_owner_idx ON conversation_share_links(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS operation_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  job_type VARCHAR(48) NOT NULL CHECK (job_type IN ('artifact_generation', 'knowledge_indexing', 'data_analysis', 'conversation_export')),
  status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partially_completed', 'failed', 'cancelled')),
  idempotency_key VARCHAR(120),
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  cancel_requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_code VARCHAR(80),
  error_message VARCHAR(400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, job_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS operation_jobs_owner_idx ON operation_jobs(user_id, created_at DESC);
