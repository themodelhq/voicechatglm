-- v1.2.4: every newly created public share is finite and publishes an immutable,
-- privacy-filtered message snapshot. Legacy no-expiry links expire at this migration
-- cutoff (their original creation time) and never become silently permanent.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS share_version BIGINT NOT NULL DEFAULT 0
  CHECK (share_version >= 0);

UPDATE conversation_share_links
  SET expires_at = created_at
  WHERE expires_at IS NULL;

ALTER TABLE conversation_share_links
  ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0
  CHECK (message_count >= 0);

CREATE INDEX IF NOT EXISTS conversation_share_links_expiry_idx
  ON conversation_share_links(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS conversation_share_messages (
  share_id UUID NOT NULL REFERENCES conversation_share_links(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  message_id UUID NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (share_id, ordinal),
  UNIQUE (share_id, message_id)
);
CREATE INDEX IF NOT EXISTS conversation_share_messages_page_idx
  ON conversation_share_messages(share_id, ordinal);
