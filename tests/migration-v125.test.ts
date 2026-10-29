import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { newDb, DataType } from 'pg-mem';

const require = createRequire(import.meta.url);
const { runMigrations, MIGRATIONS_DIRECTORY } = require('../server/db/migrate.cjs') as typeof import('../server/db/migrate.cjs');

describe('v1.2.5 migration upgrade', () => {
  it('upgrades an actual v1.2.4 migration sequence by adding preview-proof persistence without dropping data', async () => {
    const db = newDb(); db.public.registerFunction({ name: 'pg_advisory_lock', args: [DataType.integer], returns: DataType.bool, implementation: () => true }); db.public.registerFunction({ name: 'pg_advisory_unlock', args: [DataType.integer], returns: DataType.bool, implementation: () => true }); const pg = db.adapters.createPg(); const pool = new pg.Pool(); const oldDirectory = mkdtempSync(join(tmpdir(), 'voicechatglm-v124-'));
    try {
      for (const name of readdirSync(MIGRATIONS_DIRECTORY).filter(item => /^00[1-5]_/.test(item))) copyFileSync(join(MIGRATIONS_DIRECTORY, name), join(oldDirectory, name));
      await runMigrations({ pool, directory: oldDirectory });
      await pool.query("INSERT INTO users (id,email_normalized,password_hash) VALUES ('00000000-0000-4000-8000-000000000001','migration-v125@example.test','hash')");
      await pool.query("INSERT INTO conversations (id,user_id,title) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Preserved conversation')");
      await pool.query("INSERT INTO conversation_share_links (id,conversation_id,user_id,token_hash,selected_message_ids,title,expires_at,message_count) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',$1,'[]'::jsonb,'Preserved share',NOW() + INTERVAL '1 hour',0)", ['d'.repeat(64)]);
      await pool.query(readFileSync(join(MIGRATIONS_DIRECTORY, '006_share_preview_integrity.sql'), 'utf8'));
      const row = (await pool.query('SELECT title,preview_digest FROM conversation_share_links WHERE id = $1', ['00000000-0000-4000-8000-000000000003'])).rows[0];
      expect(row).toMatchObject({ title: 'Preserved share', preview_digest: null });
      expect((await pool.query("SELECT title FROM conversations WHERE id = '00000000-0000-4000-8000-000000000002' ")).rows[0].title).toBe('Preserved conversation');
    } finally { rmSync(oldDirectory, { recursive: true, force: true }); await pool.end(); }
  });
});
