import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { execute, resetRateLimitForTests } = require('../server/proxy-core.cjs') as typeof import('../server/proxy-core.cjs');

afterEach(() => resetRateLimitForTests());
const token = 'A'.repeat(43);
function repository() { return { sharedConversationByTokenHash: async (_hash: string, page: { after: number; limit: number }) => ({ share: { scope: 'full', expiresAt: new Date(Date.now() + 60_000), messageCount: 2 }, title: 'Safe snapshot', messageCount: 2, nextCursor: page.after < 0 ? 0 : undefined, messages: [{ id: page.after < 0 ? 'one' : 'two', role: 'assistant', content: 'Permitted text only', createdAt: new Date().toISOString() }] }) }; }
function env(extra: NodeJS.ProcessEnv = {}) { return { NODE_ENV: 'development', VOICECHATGLM_API_URL: 'http://model.example.test', VOICECHATGLM_API_KEY: 'test-key', CONVERSATION_SHARING_ENABLED: 'true', CONVERSATION_SHARE_MAX_HOURS: '720', ...extra } as NodeJS.ProcessEnv; }

describe('public share HTTP boundary', () => {
  it('paginates only through a bearer token and sends non-cacheable, no-referrer, no-index response headers', async () => {
    const output = await execute(`share/${token}`, 'GET', undefined, { repository: repository(), rateLimitKey: 'peer:test', query: { after: '0', limit: '1' } }, env());
    expect(output.statusCode).toBe(200); expect(output.headers['Cache-Control']).toBe('no-store'); expect(output.headers['Referrer-Policy']).toBe('no-referrer'); expect(output.headers['X-Robots-Tag']).toContain('noindex'); expect(JSON.parse(output.body).messages).toEqual([expect.objectContaining({ content: 'Permitted text only' })]); expect(JSON.parse(output.body)).not.toHaveProperty('conversationId');
  });
  it('rate-limits public retrieval without revealing token validity', async () => {
    const first = await execute(`share/${token}`, 'GET', undefined, { repository: repository(), rateLimitKey: 'peer:limited' }, env({ CONVERSATION_SHARE_PUBLIC_BURST_PER_MINUTE: '1' })); const second = await execute(`share/${token}`, 'GET', undefined, { repository: repository(), rateLimitKey: 'peer:limited' }, env({ CONVERSATION_SHARE_PUBLIC_BURST_PER_MINUTE: '1' }));
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(429); expect(JSON.parse(second.body).error).toBe('Shared conversation is temporarily unavailable.'); expect(second.headers['Retry-After']).toBeTruthy();
  });
});
