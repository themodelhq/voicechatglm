import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { Repository } = require('../server/db/repository.cjs') as { Repository: new (pool: any) => any };

describe('database-backed analysis capacity claim', () => {
  it('takes a per-owner PostgreSQL advisory transaction lock before checking and inserting a job', async () => {
    const queries: string[] = []; const client = { query: async (sql: string) => { queries.push(sql); if (sql.includes('COUNT(*)')) return { rows: [{ count: 0 }] }; return { rows: [] }; }, release: () => undefined }; const repository = new Repository({ connect: async () => client });
    await repository.createAnalysisJob({ userId: 'owner-1', fileIds: ['file-1'], request: { question: 'q' }, maxConcurrent: 2 });
    expect(queries[0]).toBe('BEGIN'); expect(queries[1]).toContain('pg_advisory_xact_lock'); expect(queries[2]).toContain('COUNT(*)'); expect(queries.findIndex(query => query.includes('INSERT INTO analysis_jobs'))).toBeGreaterThan(2); expect(queries[queries.length - 1]).toBe('COMMIT');
  });
  it('rolls back without inserting when the locked owner capacity is already occupied', async () => {
    const queries: string[] = []; const client = { query: async (sql: string) => { queries.push(sql); if (sql.includes('COUNT(*)')) return { rows: [{ count: 2 }] }; return { rows: [] }; }, release: () => undefined }; const repository = new Repository({ connect: async () => client });
    await expect(repository.createAnalysisJob({ userId: 'owner-1', fileIds: ['file-1'], request: { question: 'q' }, maxConcurrent: 2 })).resolves.toBeUndefined(); expect(queries).toContain('ROLLBACK'); expect(queries.some(query => query.includes('INSERT INTO analysis_jobs'))).toBe(false);
  });
});
