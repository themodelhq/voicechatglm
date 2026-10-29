import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newDb, DataType } from 'pg-mem';

const require = createRequire(import.meta.url);
const { runMigrations } = require('../server/db/migrate.cjs') as typeof import('../server/db/migrate.cjs');
const { Repository } = require('../server/db/repository.cjs') as typeof import('../server/db/repository.cjs');
const { handleShareRoute, handlePublicShare } = require('../server/share-routes.cjs') as typeof import('../server/share-routes.cjs');
const { handleConversationRoute } = require('../server/conversation-routes.cjs') as typeof import('../server/conversation-routes.cjs');

const env = { CONVERSATION_SHARING_ENABLED: 'true', CONVERSATION_SHARE_MAX_HOURS: '720' } as NodeJS.ProcessEnv;
async function memoryPool() {
  const db = newDb();
  db.public.registerFunction({ name: 'pg_advisory_lock', args: [DataType.integer], returns: DataType.bool, implementation: () => true });
  db.public.registerFunction({ name: 'pg_advisory_unlock', args: [DataType.integer], returns: DataType.bool, implementation: () => true });
  const pg = db.adapters.createPg(); const pool = new pg.Pool(); await runMigrations({ pool }); return pool;
}
async function preview(repository: any, userId: string, conversationId: string, scope: 'selected' | 'full' = 'full', selectedMessageIds?: string[]) {
  const result = await handleShareRoute({ route: 'shares/preview', method: 'POST', body: { conversationId, scope, ...(scope === 'selected' ? { selectedMessageIds } : {}), expiresInHours: 24 }, userId, repository, env });
  expect(result.status).toBe(200); expect(result.body.preview.previewDigest).toMatch(/^[a-f0-9]{64}$/); return result.body.preview;
}
async function publish(repository: any, userId: string, conversationId: string, snapshot: any, scope: 'selected' | 'full' = 'full', selectedMessageIds?: string[]) {
  return handleShareRoute({ route: 'shares', method: 'POST', body: { conversationId, scope, ...(scope === 'selected' ? { selectedMessageIds } : {}), expiresInHours: 24, expectedShareVersion: snapshot.shareVersion, expectedPreviewDigest: snapshot.previewDigest }, userId, repository, env });
}
async function version(repository: any, userId: string, conversationId: string) { return (await repository.conversationForOwner(userId, conversationId))!.shareVersion; }

describe('v1.2.5 share-revision integrity', () => {
  it('invalidates the exact preview after each share-relevant mutation and allows a fresh retry', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'revision-owner@example.test', passwordHash: 'hash' }); const conversation = await repository.createConversation({ userId: owner.id, title: 'Initial title' });
    const user = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'user', content: 'Original request' });
    const assistant = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'Original response' });
    const trailing = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'Trailing answer' });
    const stale = async (mutate: () => Promise<unknown>) => { const before = await preview(repository, owner.id, conversation.id); const beforeVersion = await version(repository, owner.id, conversation.id); await mutate(); expect(await version(repository, owner.id, conversation.id)).toBe(beforeVersion + 1); expect((await publish(repository, owner.id, conversation.id, before)).status).toBe(409); };

    await stale(() => repository.updateConversationMessage({ userId: owner.id, conversationId: conversation.id, id: assistant!.id, content: 'Edited response' }));
    await stale(() => repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'New answer' }));
    await stale(() => repository.updateConversation(owner.id, conversation.id, { title: 'Renamed conversation' }));
    await stale(() => repository.updateConversationMessage({ userId: owner.id, conversationId: conversation.id, id: assistant!.id, role: 'tool' }));
    // Restore eligibility for the remaining mutation cases.
    await repository.updateConversationMessage({ userId: owner.id, conversationId: conversation.id, id: assistant!.id, role: 'assistant' });
    await stale(() => repository.softDeleteConversationMessage({ userId: owner.id, conversationId: conversation.id, id: assistant!.id }));
    await stale(() => repository.restoreConversationMessage({ userId: owner.id, conversationId: conversation.id, id: assistant!.id }));
    await stale(() => repository.resubmitConversationUserMessage({ userId: owner.id, conversationId: conversation.id, id: user!.id, content: 'Resubmitted request' }));

    expect(await repository.conversationMessageForOwner(owner.id, conversation.id, trailing!.id)).toBeUndefined();
    const fresh = await preview(repository, owner.id, conversation.id);
    const created = await publish(repository, owner.id, conversation.id, fresh);
    expect(created.status).toBe(201);
    expect((await handlePublicShare({ token: created.body.token, repository, env })).body.messages.map((message: any) => message.content)).toEqual(['Resubmitted request']);
    await pool.end();
  });

  it('enforces preview content proof, REST delete/restore ownership, and does not accept a forged same-version request', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'proof-owner@example.test', passwordHash: 'hash' }); const other = await repository.createUser({ email: 'proof-other@example.test', passwordHash: 'hash' }); const conversation = await repository.createConversation({ userId: owner.id, title: 'Proof' }); const message = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'One' });
    const current = await preview(repository, owner.id, conversation.id);
    const forged = await handleShareRoute({ route: 'shares', method: 'POST', body: { conversationId: conversation.id, scope: 'full', expiresInHours: 24, expectedShareVersion: current.shareVersion, expectedPreviewDigest: '0'.repeat(64) }, userId: owner.id, repository, env });
    expect(forged.status).toBe(409);
    expect((await handleShareRoute({ route: `shares/${current.shareVersion}`, method: 'DELETE', userId: other.id, repository, env })).status).toBe(404);
    const deleted = await handleConversationRoute({ route: `conversations/${conversation.id}/messages/${message!.id}`, method: 'DELETE', userId: owner.id, repository }); expect(deleted.status).toBe(200);
    expect((await handleConversationRoute({ route: `conversations/${conversation.id}/messages/${message!.id}/restore`, method: 'POST', userId: other.id, repository })).status).toBe(404);
    const restored = await handleConversationRoute({ route: `conversations/${conversation.id}/messages/${message!.id}/restore`, method: 'POST', userId: owner.id, repository }); expect(restored.status).toBe(200);
    await pool.end();
  });

  it('serializes a preview/create race with a mutation and never publishes changed content under an old proof', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'race-owner@example.test', passwordHash: 'hash' }); const conversation = await repository.createConversation({ userId: owner.id, title: 'Race' }); const message = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'Before race' }); const approved = await preview(repository, owner.id, conversation.id);
    const [created] = await Promise.all([
      publish(repository, owner.id, conversation.id, approved),
      repository.updateConversationMessage({ userId: owner.id, conversationId: conversation.id, id: message!.id, content: 'After race' }),
    ]);
    expect([201, 409]).toContain(created.status);
    if (created.status === 201) expect((await handlePublicShare({ token: created.body.token, repository, env })).body.messages.map((item: any) => item.content)).toEqual(['Before race']);
    const fresh = await preview(repository, owner.id, conversation.id); expect(fresh.messages.map((item: any) => item.content)).toEqual(['After race']);
    const retried = await publish(repository, owner.id, conversation.id, fresh); expect(retried.status).toBe(201);
    await pool.end();
  });

  it('issues an explicit database rollback when resubmission fails after message writes', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'rollback-owner@example.test', passwordHash: 'hash' }); const conversation = await repository.createConversation({ userId: owner.id, title: 'Rollback' }); const first = await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'user', content: 'Before' }); await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'assistant', content: 'Must remain' });
    const commands: string[] = []; const failingPool = { connect: async () => { const client = await pool.connect(); return { query: async (sql: string, values?: unknown[]) => { commands.push(sql); if (sql.startsWith('UPDATE conversations SET title =')) throw new Error('injected final write failure'); return client.query(sql, values); }, release: () => client.release() }; } };
    const failingRepository = new Repository(failingPool as any);
    await expect(failingRepository.resubmitConversationUserMessage({ userId: owner.id, conversationId: conversation.id, id: first!.id, content: 'After' })).rejects.toThrow('injected final write failure');
    expect(commands).toContain('BEGIN'); expect(commands).toContain('ROLLBACK');
    await pool.end();
  });


  it('allows simultaneous valid publications only for the same approved immutable candidate', async () => {
    const pool = await memoryPool(); const repository = new Repository(pool); const owner = await repository.createUser({ email: 'two-share-owner@example.test', passwordHash: 'hash' }); const conversation = await repository.createConversation({ userId: owner.id, title: 'Two shares' }); await repository.createConversationMessage({ userId: owner.id, conversationId: conversation.id, role: 'user', content: 'Fixed approved content' }); const approved = await preview(repository, owner.id, conversation.id);
    const results = await Promise.all([publish(repository, owner.id, conversation.id, approved), publish(repository, owner.id, conversation.id, approved)]);
    expect(results.map(item => item.status)).toEqual([201, 201]);
    for (const result of results) expect((await handlePublicShare({ token: result.body.token, repository, env })).body.messages.map((message: any) => message.content)).toEqual(['Fixed approved content']);
    await pool.end();
  });
});
