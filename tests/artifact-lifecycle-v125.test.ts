import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { newDb, DataType } from 'pg-mem';

const require = createRequire(import.meta.url);
const { runMigrations } = require('../server/db/migrate.cjs') as typeof import('../server/db/migrate.cjs');
const { Repository } = require('../server/db/repository.cjs') as typeof import('../server/db/repository.cjs');
const { handleArtifactRoute } = require('../server/artifact-routes.cjs') as typeof import('../server/artifact-routes.cjs');
const { persistGeneratedArtifact } = require('../server/artifacts.cjs') as typeof import('../server/artifacts.cjs');

const env = {
  NODE_ENV: 'test', ARTIFACT_DELIVERY_ENABLED: 'true', ARTIFACT_RETENTION_HOURS: '24', FILE_STORAGE_S3_BUCKET: 'private-bucket', FILE_STORAGE_S3_REGION: 'test-region', FILE_STORAGE_S3_ENDPOINT: 'http://storage.test', FILE_STORAGE_S3_ACCESS_KEY_ID: 'test-access-key', FILE_STORAGE_S3_SECRET_ACCESS_KEY: 'test-secret-key',
} as NodeJS.ProcessEnv;
async function memoryPool() { const db = newDb(); db.public.registerFunction({ name: 'pg_advisory_lock', args: [DataType.integer], returns: DataType.bool, implementation: () => true }); db.public.registerFunction({ name: 'pg_advisory_unlock', args: [DataType.integer], returns: DataType.bool, implementation: () => true }); const pg = db.adapters.createPg(); const pool = new pg.Pool(); await runMigrations({ pool }); return pool; }
function privateStore() { const objects = new Map<string, Buffer>(); return { objects, keyFor: (suffix: string) => `private/${suffix}`, putBuffer: async (key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); }, getBuffer: async (key: string) => { const bytes = objects.get(key); if (!bytes) throw new Error('not found'); return Buffer.from(bytes); }, delete: async (key: string) => { objects.delete(key); } }; }

describe('v1.2.5 private artifact lifecycle compensation', () => {
  it('requires owner authorization for download and confirms deletion only after private-object removal', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'artifact-owner@example.test', passwordHash: 'hash' }); const other = await repository.createUser({ email: 'artifact-other@example.test', passwordHash: 'hash' }); const store = privateStore();
    const created = await handleArtifactRoute({ route: 'artifacts', method: 'POST', body: { format: 'txt', title: 'Private report', content: 'Only the owner can download this.' }, userId: owner.id, repository, env, store }); expect(created.status).toBe(201); const artifactId = created.body.artifact.id;
    expect((await handleArtifactRoute({ route: `artifacts/${artifactId}/download`, method: 'GET', userId: other.id, repository, env, store })).status).toBe(404);
    expect((await handleArtifactRoute({ route: `artifacts/${artifactId}/download`, method: 'GET', userId: owner.id, repository, env, store })).status).toBe(200);
    expect(await handleArtifactRoute({ route: `artifacts/${artifactId}`, method: 'DELETE', userId: owner.id, repository, env, store })).toMatchObject({ status: 200, body: { deleted: true } });
    expect(await repository.artifactForOwner(owner.id, artifactId)).toBeUndefined(); expect(store.objects.size).toBe(0);
    await pool.end();
  });

  it('does not report successful deletion if object storage fails and restores metadata authorization', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'artifact-retry@example.test', passwordHash: 'hash' }); const store = privateStore();
    const created = await handleArtifactRoute({ route: 'artifacts', method: 'POST', body: { format: 'txt', title: 'Retry report', content: 'Keep private until deletion succeeds.' }, userId: owner.id, repository, env, store }); const artifactId = created.body.artifact.id;
    store.delete = async () => { throw new Error('storage unavailable'); };
    const deleted = await handleArtifactRoute({ route: `artifacts/${artifactId}`, method: 'DELETE', userId: owner.id, repository, env, store }); expect(deleted).toMatchObject({ status: 503, body: { code: 'ARTIFACT_DELETE_FAILED' } });
    expect((await repository.artifactForOwner(owner.id, artifactId))?.id).toBe(artifactId); expect(store.objects.size).toBe(1);
    await pool.end();
  });

  it('compensates an already-written object when artifact metadata persistence fails', async () => {
    const store = privateStore(); const repository = { createArtifact: async () => { throw new Error('database unavailable'); } };
    await expect(persistGeneratedArtifact({ repository, store, userId: 'user-id', title: 'Compensation', content: 'No orphan', format: 'txt' })).rejects.toThrow('database unavailable');
    expect(store.objects.size).toBe(0);
  });
});
