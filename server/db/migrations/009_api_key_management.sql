-- v1.3.0: owner-scoped external API credentials. Secrets are never stored here.
-- key_identifier locates a record; secret_hash is an HMAC-SHA-256 of the random secret.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (name <> ''),
  description VARCHAR(500),
  key_identifier VARCHAR(20) NOT NULL UNIQUE CHECK (key_identifier LIKE 'vcg_%'),
  secret_hash CHAR(64) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["chat:write"]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS api_keys_owner_created_idx ON api_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_active_lookup_idx ON api_keys(key_identifier) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_expiry_idx ON api_keys(expires_at) WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- Lifecycle auditing never records a bearer credential, hash, request header, or model secret.
CREATE TABLE IF NOT EXISTS api_key_audit_events (
  id UUID PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL CHECK (action IN ('created', 'revoked')),
  outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_key_audit_owner_created_idx ON api_key_audit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_key_audit_key_created_idx ON api_key_audit_events(api_key_id, created_at DESC);
