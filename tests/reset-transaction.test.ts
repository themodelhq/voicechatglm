import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url); const { Repository } = require('../server/db/repository.cjs') as typeof import('../server/db/repository.cjs');

const lockedRow = { reset_id: '00000000-0000-4000-8000-000000000010', user_id: '00000000-0000-4000-8000-000000000011', id: '00000000-0000-4000-8000-000000000011', email_normalized: 'person@example.test', display_name: null, account_status: 'active', email_verified_at: null, created_at: new Date() };
function scriptedPool({ failInsert = false } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }; if (sql.includes('FROM password_reset_tokens')) return { rows: [lockedRow], rowCount: 1 }; if (sql.startsWith('UPDATE users')) return { rows: [{ ...lockedRow, password_changed_at: new Date(), updated_at: new Date() }], rowCount: 1 }; if (sql.startsWith('UPDATE password_reset_tokens')) return { rows: [{ id: lockedRow.reset_id }], rowCount: 1 }; if (sql.startsWith('UPDATE sessions')) return { rows: [], rowCount: 1 }; if (sql.startsWith('INSERT INTO sessions')) { if (failInsert) throw new Error('simulated insert failure'); return { rows: [], rowCount: 1 }; } throw new Error(`Unexpected query: ${sql}`); }, release: () => undefined };
  return { calls, connect: async () => client };
}
const input = { tokenHash: 'a'.repeat(64), password: 'new secure password 456', validatePassword: (password: string, email: string) => password.startsWith('new ') && email === 'person@example.test', hashPassword: async () => '$argon2id$derived-only-inside-memory', replacementSession: { tokenHash: 'b'.repeat(64), csrfTokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 60_000) } };

describe('transactional reset persistence', () => {
  it('locks, validates, changes, consumes, revokes and creates the replacement session in one commit without putting password plaintext in SQL values', async () => {
    const pool = scriptedPool(); const result = await new Repository(pool as any).resetPasswordWithToken(input); expect(result).toMatchObject({ outcome: 'success', user: { id: lockedRow.user_id, email: 'person@example.test' } });
    const sql = pool.calls.map(call => call.sql); expect(sql).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT'])); expect(sql.findIndex(statement => statement.includes('FOR UPDATE'))).toBeGreaterThan(-1); expect(sql.findIndex(statement => statement.startsWith('UPDATE users'))).toBeLessThan(sql.findIndex(statement => statement.startsWith('UPDATE password_reset_tokens'))); expect(sql.findIndex(statement => statement.startsWith('UPDATE password_reset_tokens'))).toBeLessThan(sql.findIndex(statement => statement.startsWith('UPDATE sessions')));
    expect(pool.calls.flatMap(call => call.values || []).join(' ')).not.toContain(input.password);
  });
  it('rolls back before mutation for account-specific password-policy failure', async () => {
    const pool = scriptedPool(); const result = await new Repository(pool as any).resetPasswordWithToken({ ...input, validatePassword: () => false }); expect(result).toEqual({ outcome: 'password_invalid' }); expect(pool.calls.map(call => call.sql)).toEqual(expect.arrayContaining(['BEGIN', 'ROLLBACK'])); expect(pool.calls.some(call => call.sql.startsWith('UPDATE users'))).toBe(false); expect(pool.calls.some(call => call.sql.startsWith('UPDATE password_reset_tokens'))).toBe(false);
  });
  it('rolls back all reset changes when a later database operation fails', async () => {
    const pool = scriptedPool({ failInsert: true }); await expect(new Repository(pool as any).resetPasswordWithToken(input)).rejects.toThrow('simulated insert failure'); const sql = pool.calls.map(call => call.sql); expect(sql).toContain('ROLLBACK'); expect(sql).not.toContain('COMMIT');
  });
});
