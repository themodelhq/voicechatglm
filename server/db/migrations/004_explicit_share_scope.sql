-- v1.2.3: shares must state their scope explicitly. Existing links are conservatively
-- treated as selected-content links; an empty legacy selection therefore exposes nothing.
ALTER TABLE conversation_share_links
  ADD COLUMN IF NOT EXISTS share_scope VARCHAR(16) NOT NULL DEFAULT 'selected'
  CHECK (share_scope IN ('selected', 'full'));

CREATE INDEX IF NOT EXISTS conversation_share_links_scope_idx
  ON conversation_share_links(conversation_id, share_scope)
  WHERE revoked_at IS NULL;
