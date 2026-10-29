-- v1.2.5: retain the content-addressed proof used to create each immutable share.
-- The preview digest is calculated server-side from the eligible, ordered snapshot
-- candidate while the conversation is locked. It is never a bearer credential.

ALTER TABLE conversation_share_links
  ADD COLUMN IF NOT EXISTS preview_digest VARCHAR(64);

CREATE INDEX IF NOT EXISTS conversation_share_links_conversation_created_idx
  ON conversation_share_links(conversation_id, created_at DESC);
