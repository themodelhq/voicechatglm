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

describe('durable analysis worker leases', () => {
  it('claims one queued job under a row lock and increments its attempt count', async () => {
    const queries: string[] = [];
    const job = { id: 'job-1', user_id: 'owner-1', status: 'processing', attempts: 1, max_attempts: 3, request: { question: 'q' } };
    const client = { query: async (sql: string) => { queries.push(sql); if (sql.includes('SELECT * FROM analysis_jobs')) return { rows: [{ ...job, attempts: 0, status: 'queued' }] }; if (sql.includes('RETURNING *')) return { rows: [job] }; return { rows: [] }; }, release: () => undefined };
    const repository = new Repository({ connect: async () => client });
    await expect(repository.claimAnalysisJob('worker-1', 120000)).resolves.toEqual(job);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toContain('FOR UPDATE SKIP LOCKED');
    expect(queries[2]).toContain('attempts=attempts+1');
    expect(queries[2]).toContain('lease_expires_at');
    expect(queries[3]).toBe('COMMIT');
  });

  it('renews only the current worker lease and returns the cancellation flag', async () => {
    let query = '';
    const repository = new Repository({ query: async (sql: string) => { query = sql; return { rows: [{ cancel_requested_at: null }] }; } });
    await expect(repository.renewAnalysisJobLease('job-1', 'worker-1', 120000)).resolves.toEqual({ cancelRequested: false });
    expect(query).toContain('worker_id=$2');
    expect(query).toContain("status='processing'");
  });

  it('guards finalization with the current worker ID', async () => {
    let query = '';
    const repository = new Repository({ query: async (sql: string) => { query = sql; return { rowCount: 1, rows: [{ id: 'job-1' }] }; } });
    await expect(repository.completeAnalysisJob({ id: 'job-1', status: 'analysis_completed', resultStorageKey: 'private/result', workerId: 'worker-1' })).resolves.toBe(true);
    expect(query).toContain('worker_id = $6');
    expect(query).toContain('lease_expires_at=NULL');
  });

  it('requeues expired leases instead of failing every long-running analysis', async () => {
    const queries: string[] = [];
    const repository = new Repository({ query: async (sql: string) => { queries.push(sql); return { rows: [] }; } });
    await repository.recoverStaleJobs(90000);
    expect(queries[0]).toContain("THEN 'queued' ELSE 'failed'");
    expect(queries[0]).toContain('lease_expires_at');
  });
});
